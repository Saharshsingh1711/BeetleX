import { Request, Response, NextFunction } from 'express';
import { PrismaClient, TeamMemberRole } from '@prisma/client';
import crypto from 'crypto';
import { AppError } from '../utils/errors';

const prisma = new PrismaClient();

const generateInviteCode = (): string => {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
};

export const createTeam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const userId = req.user?.userId;
    const { name, track } = req.body;

    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const registration = await prisma.registration.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (!registration || registration.status !== 'CONFIRMED') {
      throw new AppError('Forbidden: Only users with a confirmed registration can create teams', 403, 'FORBIDDEN');
    }

    if (registration.teamId) {
      throw new AppError('Conflict: You are already a member of a team for this event', 409, 'ALREADY_IN_TEAM');
    }

    const event = await prisma.event.findFirst({ where: { id: eventId, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    const existingTeamName = await prisma.team.findUnique({
      where: {
        eventId_name: {
          eventId,
          name,
        },
      },
    });

    if (existingTeamName && existingTeamName.isActive) {
      throw new AppError('Team name is already taken for this event', 400, 'TEAM_NAME_TAKEN');
    }

    const inviteCode = generateInviteCode();

    const team = await prisma.$transaction(async (tx) => {
      const newTeam = await tx.team.create({
        data: {
          eventId,
          name,
          track,
          inviteCode,
          leaderId: userId,
          inOpen: true,
          isActive: true,
        },
      });

      await tx.teamMember.create({
        data: {
          teamId: newTeam.id,
          userId,
          role: 'LEADER' as TeamMemberRole,
        },
      });

      await tx.registration.update({
        where: {
          eventId_userId: {
            eventId,
            userId,
          },
        },
        data: {
          teamId: newTeam.id,
        },
      });

      return newTeam;
    });

    res.status(201).json({ message: 'Team created successfully', team });
  } catch (error) {
    next(error);
  }
};

export const getTeams = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const { isOpen, track } = req.query;

    const where: any = { eventId, isActive: true };

    if (isOpen !== undefined) {
      where.inOpen = isOpen === 'true';
    }

    if (track) {
      where.track = track as string;
    }

    const teams = await prisma.team.findMany({
      where,
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    res.status(200).json({ teams });
  } catch (error) {
    next(error);
  }
};

export const getTeamById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const team = await prisma.team.findFirst({
      where: { id, isActive: true },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!team) {
      throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
    }

    res.status(200).json({ team });
  } catch (error) {
    next(error);
  }
};

export const updateTeam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    const { name, track, isOpen } = req.body;

    const team = await prisma.team.findFirst({ where: { id, isActive: true } });
    if (!team) {
      throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
    }

    if (team.leaderId !== userId) {
      throw new AppError('Forbidden: Only the team leader can modify team details', 403, 'FORBIDDEN');
    }

    const updateData: any = {};
    if (name !== undefined) {
      const existingTeamName = await prisma.team.findUnique({
        where: {
          eventId_name: {
            eventId: team.eventId,
            name,
          },
        },
      });
      if (existingTeamName && existingTeamName.id !== id && existingTeamName.isActive) {
        throw new AppError('Team name is already taken for this event', 400, 'TEAM_NAME_TAKEN');
      }
      updateData.name = name;
    }

    if (track !== undefined) {
      updateData.track = track;
    }

    if (isOpen !== undefined) {
      updateData.inOpen = isOpen;
    }

    const updatedTeam = await prisma.team.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({ message: 'Team updated successfully', team: updatedTeam });
  } catch (error) {
    next(error);
  }
};

export const joinTeam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const { inviteCode } = req.body;

    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const team = await prisma.team.findFirst({
      where: { inviteCode, isActive: true },
      include: { event: true },
    });

    if (!team) {
      throw new AppError('Team not found with the provided invite code', 404, 'TEAM_NOT_FOUND');
    }

    const registration = await prisma.registration.findUnique({
      where: {
        eventId_userId: {
          eventId: team.eventId,
          userId,
        },
      },
    });

    if (!registration || registration.status !== 'CONFIRMED') {
      throw new AppError('Forbidden: You must have a confirmed registration for this event to join a team', 403, 'FORBIDDEN');
    }

    if (registration.teamId) {
      throw new AppError('Conflict: You are already a member of a team for this event', 409, 'ALREADY_IN_TEAM');
    }

    if (!team.inOpen) {
      throw new AppError('Team is not accepting new members', 400, 'TEAM_CLOSED');
    }

    const currentMemberCount = await prisma.teamMember.count({
      where: { teamId: team.id },
    });

    if (currentMemberCount >= team.event.maxTeamSize) {
      throw new AppError('Team has reached its maximum size capacity', 400, 'TEAM_FULL');
    }

    const joinedTeam = await prisma.$transaction(async (tx) => {
      const member = await tx.teamMember.create({
        data: {
          teamId: team.id,
          userId,
          role: 'MEMBER' as TeamMemberRole,
        },
      });

      await tx.registration.update({
        where: {
          eventId_userId: {
            eventId: team.eventId,
            userId,
          },
        },
        data: {
          teamId: team.id,
        },
      });

      return member;
    });

    res.status(200).json({ message: 'Joined team successfully', teamId: team.id });
  } catch (error) {
    next(error);
  }
};

export const removeTeamMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const currentUserId = req.user?.userId;

    const team = await prisma.team.findFirst({ where: { id: teamId, isActive: true } });
    if (!team) {
      throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
    }

    if (team.leaderId !== currentUserId) {
      throw new AppError('Forbidden: Only the team leader can remove members', 403, 'FORBIDDEN');
    }

    if (targetUserId === currentUserId) {
      throw new AppError('Bad Request: Leaders cannot remove themselves. Disband the team instead.', 400, 'LEADER_CANNOT_LEAVE');
    }

    const isMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: targetUserId,
        },
      },
    });

    if (!isMember) {
      throw new AppError('User is not a member of this team', 404, 'MEMBER_NOT_FOUND');
    }

    await prisma.$transaction([
      prisma.teamMember.delete({
        where: {
          teamId_userId: {
            teamId,
            userId: targetUserId,
          },
        },
      }),
      prisma.registration.update({
        where: {
          eventId_userId: {
            eventId: team.eventId,
            userId: targetUserId,
          },
        },
        data: {
          teamId: null,
        },
      }),
    ]);

    res.status(200).json({ message: 'Team member removed successfully' });
  } catch (error) {
    next(error);
  }
};

export const disbandTeam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;

    const team = await prisma.team.findFirst({
      where: { id, isActive: true },
      include: { event: true },
    });

    if (!team) {
      throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
    }

    if (team.leaderId !== userId) {
      throw new AppError('Forbidden: Only the team leader can disband the team', 403, 'FORBIDDEN');
    }

    if (new Date() >= team.event.submissionDeadline) {
      throw new AppError('Cannot disband team after the project submission deadline has passed', 400, 'SUBMISSION_DEADLINE_PASSED');
    }

    await prisma.$transaction([
      // Unlink all member registrations
      prisma.registration.updateMany({
        where: { teamId: id },
        data: { teamId: null },
      }),
      // Delete all member memberships
      prisma.teamMember.deleteMany({
        where: { teamId: id },
      }),
      // Soft-delete the team
      prisma.team.update({
        where: { id },
        data: { isActive: false },
      }),
    ]);

    res.status(200).json({ message: 'Team disbanded successfully' });
  } catch (error) {
    next(error);
  }
};

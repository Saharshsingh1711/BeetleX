import { Request, Response, NextFunction } from 'express';
import { PrismaClient, ProjectStatus } from '@prisma/client';
import { AppError } from '../utils/errors';

const prisma = new PrismaClient();

export const createProjectDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.params.id as string;
    const userId = req.user?.userId;
    const { title, description, techStack, demoUrl, repoUrl, videoUrl } = req.body;

    const team = await prisma.team.findFirst({ where: { id: teamId, isActive: true } });
    if (!team) {
      throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
    }

    if (team.leaderId !== userId) {
      throw new AppError('Forbidden: Only the team leader can create the project draft', 403, 'FORBIDDEN');
    }

    const existing = await prisma.project.findUnique({
      where: {
        eventId_teamId: {
          eventId: team.eventId,
          teamId,
        },
      },
    });

    if (existing && existing.isActive) {
      throw new AppError('Conflict: A project draft already exists for this team', 409, 'PROJECT_EXISTS');
    }

    const project = await prisma.project.create({
      data: {
        eventId: team.eventId,
        teamId,
        title,
        description,
        techStack: techStack || [],
        demoUrl,
        repoUrl,
        videoUrl,
        status: 'DRAFT' as ProjectStatus,
        isActive: true,
      },
    });

    res.status(201).json({ message: 'Project draft created successfully', project });
  } catch (error) {
    next(error);
  }
};

export const getTeamProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.params.id as string;

    const project = await prisma.project.findFirst({
      where: { teamId, isActive: true },
    });

    if (!project) {
      throw new AppError('Project draft not found for this team', 404, 'PROJECT_NOT_FOUND');
    }

    res.status(200).json({ project });
  } catch (error) {
    next(error);
  }
};

export const updateProjectDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.params.id as string;
    const userId = req.user?.userId;

    const team = await prisma.team.findFirst({ where: { id: teamId, isActive: true } });
    if (!team) {
      throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
    }

    if (team.leaderId !== userId) {
      throw new AppError('Forbidden: Only the team leader can modify the project draft', 403, 'FORBIDDEN');
    }

    const project = await prisma.project.findFirst({
      where: { teamId, isActive: true },
    });

    if (!project) {
      throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    if (project.status !== 'DRAFT') {
      throw new AppError('Bad Request: Project has already been submitted and cannot be modified', 400, 'PROJECT_ALREADY_SUBMITTED');
    }

    const updateData: any = {};
    const fields = ['title', 'description', 'techStack', 'demoUrl', 'repoUrl', 'videoUrl'];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) {
        updateData[f] = req.body[f];
      }
    });

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: updateData,
    });

    res.status(200).json({ message: 'Project draft updated successfully', project: updated });
  } catch (error) {
    next(error);
  }
};

export const submitProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;

    const project = await prisma.project.findFirst({
      where: { id, isActive: true },
      include: { event: true, team: true },
    });

    if (!project) {
      throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    if (project.team.leaderId !== userId) {
      throw new AppError('Forbidden: Only the team leader can finalize the submission', 403, 'FORBIDDEN');
    }

    if (new Date() >= project.event.submissionDeadline) {
      throw new AppError('Bad Request: Project submission deadline has passed', 400, 'SUBMISSION_DEADLINE_PASSED');
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    res.status(200).json({ message: 'Project submitted successfully', project: updated });
  } catch (error) {
    next(error);
  }
};

export const uploadPitchDeck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;

    if (!req.file) {
      throw new AppError('Bad Request: Pitch deck file missing', 400, 'FILE_MISSING');
    }

    const project = await prisma.project.findFirst({
      where: { id, isActive: true },
      include: { team: true },
    });

    if (!project) {
      throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    if (project.team.leaderId !== userId) {
      throw new AppError('Forbidden: Only the team leader can upload a pitch deck', 403, 'FORBIDDEN');
    }

    const mockCdnUrl = `https://s3.amazonaws.com/beetlex-decks/deck-${id}-${Date.now()}.pdf`;

    const updated = await prisma.project.update({
      where: { id },
      data: {
        deckUrl: mockCdnUrl,
      },
    });

    res.status(200).json({
      message: 'Pitch deck uploaded successfully (mocked S3)',
      deckUrl: mockCdnUrl,
      project: updated,
    });
  } catch (error) {
    next(error);
  }
};

export const getEventProjects = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    const event = await prisma.event.findFirst({ where: { id: eventId, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    let isAllowed = false;
    if (userRole === 'ADMIN' || event.organizerId === userId) {
      isAllowed = true;
    } else {
      const isJudge = await prisma.eventJudge.findUnique({
        where: {
          eventId_judgeId: {
            eventId,
            judgeId: userId as string,
          },
        },
      });
      if (isJudge) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      throw new AppError('Forbidden: You are not authorized to view the projects for this event', 403, 'FORBIDDEN');
    }

    const projects = await prisma.project.findMany({
      where: { eventId, status: 'SUBMITTED', isActive: true },
      include: {
        team: {
          select: {
            name: true,
            track: true,
          },
        },
      },
    });

    res.status(200).json({ projects });
  } catch (error) {
    next(error);
  }
};

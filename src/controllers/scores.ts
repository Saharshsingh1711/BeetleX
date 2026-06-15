import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../utils/errors';
import { appEmitter, EVENTS } from '../utils/emitter';

const prisma = new PrismaClient();

export const getJudgeProjects = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const judgeId = req.user?.userId;
    if (!judgeId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const assignments = await prisma.eventJudge.findMany({
      where: { judgeId },
      include: { event: true },
    });

    const projectList: any[] = [];

    for (const assignment of assignments) {
      const projects = await prisma.project.findMany({
        where: {
          eventId: assignment.eventId,
          status: 'SUBMITTED',
          isActive: true,
          ...(assignment.track ? { team: { track: assignment.track } } : {}),
        },
        include: {
          team: {
            select: { name: true, track: true },
          },
          scores: {
            where: { judgeId },
          },
        },
      });

      projects.forEach((proj) => {
        projectList.push({
          id: proj.id,
          title: proj.title,
          description: proj.description,
          techStack: proj.techStack,
          demoUrl: proj.demoUrl,
          repoUrl: proj.repoUrl,
          videoUrl: proj.videoUrl,
          deckUrl: proj.deckUrl,
          submittedAt: proj.submittedAt,
          team: proj.team,
          reviewStatus: proj.scores.length > 0 ? 'SCORED' : 'PENDING',
          score: proj.scores.length > 0 ? proj.scores[0] : null,
        });
      });
    }

    res.status(200).json({ projects: projectList });
  } catch (error) {
    next(error);
  }
};

export const getJudgeProjectById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const judgeId = req.user?.userId;

    if (!judgeId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const project = await prisma.project.findFirst({
      where: { id, status: 'SUBMITTED', isActive: true },
      include: {
        team: true,
        scores: {
          where: { judgeId },
        },
      },
    });

    if (!project) {
      throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    const assignment = await prisma.eventJudge.findFirst({
      where: {
        eventId: project.eventId,
        judgeId,
        OR: [
          { track: null },
          { track: project.team.track },
        ],
      },
    });

    if (!assignment) {
      throw new AppError('Forbidden: You are not assigned to judge this project', 403, 'FORBIDDEN');
    }

    res.status(200).json({
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        techStack: project.techStack,
        demoUrl: project.demoUrl,
        repoUrl: project.repoUrl,
        videoUrl: project.videoUrl,
        deckUrl: project.deckUrl,
        teamName: project.team.name,
        track: project.team.track,
      },
      existingScore: project.scores.length > 0 ? project.scores[0] : null,
    });
  } catch (error) {
    next(error);
  }
};

export const submitScore = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params.id as string;
    const judgeId = req.user?.userId;
    const { innovation, technical, impact, presentation, comments } = req.body;

    if (!judgeId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, status: 'SUBMITTED', isActive: true },
      include: { team: true },
    });

    if (!project) {
      throw new AppError('Project not found or not submitted', 404, 'PROJECT_NOT_FOUND');
    }

    const assignment = await prisma.eventJudge.findFirst({
      where: {
        eventId: project.eventId,
        judgeId,
        OR: [
          { track: null },
          { track: project.team.track },
        ],
      },
    });

    if (!assignment) {
      throw new AppError('Forbidden: You are not assigned to judge this project', 403, 'FORBIDDEN');
    }

    const existingScore = await prisma.score.findUnique({
      where: {
        projectId_judgeId: {
          projectId,
          judgeId,
        },
      },
    });

    if (existingScore) {
      throw new AppError('Conflict: You have already submitted a score for this project. Use PATCH instead.', 409, 'SCORE_ALREADY_EXISTS');
    }

    const total = (innovation + technical + impact + presentation) / 4.0;

    const score = await prisma.score.create({
      data: {
        projectId,
        judgeId,
        innovation,
        technical,
        impact,
        presentation,
        total: new Prisma.Decimal(total),
        comments,
      },
    });

    appEmitter.emit(EVENTS.LEADERBOARD_UPDATE, { eventId: project.eventId });

    res.status(201).json({ message: 'Score submitted successfully', score });
  } catch (error) {
    next(error);
  }
};

export const updateScore = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params.id as string;
    const judgeId = req.user?.userId;
    const { innovation, technical, impact, presentation, comments } = req.body;

    if (!judgeId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const existingScore = await prisma.score.findUnique({
      where: {
        projectId_judgeId: {
          projectId,
          judgeId,
        },
      },
      include: {
        project: {
          include: { event: true },
        },
      },
    });

    if (!existingScore) {
      throw new AppError('Score not found', 404, 'SCORE_NOT_FOUND');
    }

    // Check if leaderboard/event is published (e.g. status closed)
    if (existingScore.project.event.status === 'CLOSED') {
      throw new AppError('Bad Request: Cannot modify scores after the event has closed/published', 400, 'EVENT_CLOSED');
    }

    const updatedData: any = {};
    if (comments !== undefined) updatedData.comments = comments;

    const currentInnovation = innovation !== undefined ? innovation : existingScore.innovation;
    const currentTechnical = technical !== undefined ? technical : existingScore.technical;
    const currentImpact = impact !== undefined ? impact : existingScore.impact;
    const currentPresentation = presentation !== undefined ? presentation : existingScore.presentation;

    if (innovation !== undefined) updatedData.innovation = innovation;
    if (technical !== undefined) updatedData.technical = technical;
    if (impact !== undefined) updatedData.impact = impact;
    if (presentation !== undefined) updatedData.presentation = presentation;

    const newTotal = (currentInnovation + currentTechnical + currentImpact + currentPresentation) / 4.0;
    updatedData.total = new Prisma.Decimal(newTotal);

    const updatedScore = await prisma.score.update({
      where: {
        projectId_judgeId: {
          projectId,
          judgeId,
        },
      },
      data: updatedData,
    });

    appEmitter.emit(EVENTS.LEADERBOARD_UPDATE, { eventId: existingScore.project.eventId });

    res.status(200).json({ message: 'Score updated successfully', score: updatedScore });
  } catch (error) {
    next(error);
  }
};

export const getEventScores = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const organizerId = req.user?.userId;

    const event = await prisma.event.findFirst({ where: { id: eventId, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (event.organizerId !== organizerId && req.user?.role !== 'ADMIN') {
      throw new AppError('Forbidden: Access limited to the event organizer', 403, 'FORBIDDEN');
    }

    const scores = await prisma.score.findMany({
      where: {
        project: { eventId, isActive: true },
      },
      include: {
        project: {
          select: {
            title: true,
            team: {
              select: { name: true },
            },
          },
        },
        judge: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: { total: 'desc' },
    });

    res.status(200).json({ scores });
  } catch (error) {
    next(error);
  }
};

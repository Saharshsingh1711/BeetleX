import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/errors';
import { appEmitter, EVENTS } from '../utils/emitter';

const prisma = new PrismaClient();

const fetchLeaderboardData = async (eventId: string) => {
  const projects = await prisma.project.findMany({
    where: {
      eventId,
      status: 'SUBMITTED',
      isActive: true,
    },
    include: {
      team: {
        select: { name: true, track: true },
      },
      scores: true,
    },
  });

  const list = projects.map((p) => {
    const scoresCount = p.scores.length;
    const totalSum = p.scores.reduce((sum, s) => sum + parseFloat(s.total.toString()), 0);
    const averageScore = scoresCount > 0 ? parseFloat((totalSum / scoresCount).toFixed(2)) : 0;

    return {
      projectId: p.id,
      projectTitle: p.title,
      teamName: p.team.name,
      track: p.team.track,
      averageScore,
      submittedAt: p.submittedAt || p.createdAt,
      scoresCount,
    };
  });

  // Sort: Average score desc, then submittedAt asc (tie break)
  list.sort((a, b) => {
    if (b.averageScore !== a.averageScore) {
      return b.averageScore - a.averageScore;
    }
    const timeA = new Date(a.submittedAt).getTime();
    const timeB = new Date(b.submittedAt).getTime();
    return timeA - timeB; // Earliest submission first
  });

  return list.map((item, index) => ({
    rank: index + 1,
    ...item,
  }));
};

export const getLeaderboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;

    const event = await prisma.event.findFirst({
      where: { id: eventId, isActive: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    const leaderboard = await fetchLeaderboardData(eventId);
    res.status(200).json({ leaderboard });
  } catch (error) {
    next(error);
  }
};

export const getLiveLeaderboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;

    const event = await prisma.event.findFirst({
      where: { id: eventId, isActive: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial leaderboard
    const initialData = await fetchLeaderboardData(eventId);
    res.write(`data: ${JSON.stringify({ leaderboard: initialData })}\n\n`);

    const updateHandler = async (data: { eventId: string }) => {
      if (data.eventId === eventId) {
        try {
          const updatedData = await fetchLeaderboardData(eventId);
          res.write(`data: ${JSON.stringify({ leaderboard: updatedData })}\n\n`);
        } catch (err) {
          // Silence stream errors
        }
      }
    };

    appEmitter.on(EVENTS.LEADERBOARD_UPDATE, updateHandler);

    req.on('close', () => {
      appEmitter.off(EVENTS.LEADERBOARD_UPDATE, updateHandler);
      res.end();
    });
  } catch (error) {
    next(error);
  }
};

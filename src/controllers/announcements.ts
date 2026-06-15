import { Request, Response, NextFunction } from 'express';
import { PrismaClient, AnnouncementTarget } from '@prisma/client';
import { AppError } from '../utils/errors';
import { appEmitter, EVENTS } from '../utils/emitter';

const prisma = new PrismaClient();

const getTargetsForRole = (role: string): AnnouncementTarget[] => {
  const targets: AnnouncementTarget[] = ['ALL'];
  if (role === 'PARTICIPANT') targets.push('PARTICIPANTS');
  if (role === 'JUDGE') targets.push('JUDGES');
  if (role === 'ORGANIZER') targets.push('ORGANIZERS');
  if (role === 'ADMIN') {
    targets.push('PARTICIPANTS', 'JUDGES', 'ORGANIZERS');
  }
  return targets;
};

export const createAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const authorId = req.user?.userId;
    const { title, body, priority, target } = req.body;

    if (!authorId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const event = await prisma.event.findFirst({
      where: { id: eventId, isActive: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (event.organizerId !== authorId && req.user?.role !== 'ADMIN') {
      throw new AppError('Forbidden: Only the event organizer can create announcements', 403, 'FORBIDDEN');
    }

    const announcement = await prisma.announcement.create({
      data: {
        eventId,
        authorId,
        title,
        body,
        priority,
        target,
        isPublished: false,
      },
    });

    res.status(201).json({ message: 'Announcement draft created successfully', announcement });
  } catch (error) {
    next(error);
  }
};

export const publishAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const announcementId = req.params.announcementId as string;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const event = await prisma.event.findFirst({
      where: { id: eventId, isActive: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (event.organizerId !== userId && req.user?.role !== 'ADMIN') {
      throw new AppError('Forbidden: Only the event organizer can publish announcements', 403, 'FORBIDDEN');
    }

    const announcement = await prisma.announcement.findFirst({
      where: { id: announcementId, eventId },
    });

    if (!announcement) {
      throw new AppError('Announcement not found', 404, 'ANNOUNCEMENT_NOT_FOUND');
    }

    if (announcement.isPublished) {
      throw new AppError('Announcement is already published', 400, 'ALREADY_PUBLISHED');
    }

    const updatedAnnouncement = await prisma.announcement.update({
      where: { id: announcementId },
      data: {
        isPublished: true,
        publishedAt: new Date(),
      },
    });

    // Real-time notification trigger via Emitter
    appEmitter.emit(EVENTS.ANNOUNCEMENT_PUBLISHED, { eventId, announcement: updatedAnnouncement });

    res.status(200).json({ message: 'Announcement published successfully', announcement: updatedAnnouncement });
  } catch (error) {
    next(error);
  }
};

export const getAnnouncements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const userId = req.user?.userId;
    const userRole = req.user?.role || 'PARTICIPANT';

    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const event = await prisma.event.findFirst({
      where: { id: eventId, isActive: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    const isOrganizer = event.organizerId === userId || userRole === 'ADMIN';

    let announcements: any[];
    if (isOrganizer) {
      // Organizers/admins see all (drafts & published)
      announcements = await prisma.announcement.findMany({
        where: { eventId },
        include: {
          reads: {
            where: { userId },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      // Participants/judges see only published matching their target role
      announcements = await prisma.announcement.findMany({
        where: {
          eventId,
          isPublished: true,
          target: { in: getTargetsForRole(userRole) },
        },
        include: {
          reads: {
            where: { userId },
          },
        },
        orderBy: { publishedAt: 'desc' },
      });
    }

    const result = announcements.map((ann) => ({
      id: ann.id,
      title: ann.title,
      body: ann.body,
      priority: ann.priority,
      target: ann.target,
      isPublished: ann.isPublished,
      publishedAt: ann.publishedAt,
      createdAt: ann.createdAt,
      isRead: ann.reads.length > 0,
    }));

    res.status(200).json({ announcements: result });
  } catch (error) {
    next(error);
  }
};

export const markAnnouncementAsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const announcementId = req.params.announcementId as string;
    const userId = req.user?.userId;
    const userRole = req.user?.role || 'PARTICIPANT';

    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const event = await prisma.event.findFirst({
      where: { id: eventId, isActive: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    const announcement = await prisma.announcement.findFirst({
      where: { id: announcementId, eventId },
    });

    if (!announcement) {
      throw new AppError('Announcement not found', 404, 'ANNOUNCEMENT_NOT_FOUND');
    }

    if (!announcement.isPublished) {
      throw new AppError('Cannot read an unpublished announcement', 400, 'UNPUBLISHED_ANNOUNCEMENT');
    }

    // Verify audience target
    const isOrganizerOrAdmin = event.organizerId === userId || userRole === 'ADMIN';
    const allowedTargets = getTargetsForRole(userRole);
    if (!isOrganizerOrAdmin && !allowedTargets.includes(announcement.target)) {
      throw new AppError('Forbidden: This announcement does not target your role', 403, 'FORBIDDEN');
    }

    await prisma.announcementRead.upsert({
      where: {
        announcementId_userId: {
          announcementId,
          userId,
        },
      },
      create: {
        announcementId,
        userId,
      },
      update: {},
    });

    res.status(200).json({ message: 'Announcement marked as read' });
  } catch (error) {
    next(error);
  }
};

export const getUnreadAnnouncementsCount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const userId = req.user?.userId;
    const userRole = req.user?.role || 'PARTICIPANT';

    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const event = await prisma.event.findFirst({
      where: { id: eventId, isActive: true },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    const count = await prisma.announcement.count({
      where: {
        eventId,
        isPublished: true,
        target: { in: getTargetsForRole(userRole) },
        reads: {
          none: {
            userId,
          },
        },
      },
    });

    res.status(200).json({ count });
  } catch (error) {
    next(error);
  }
};

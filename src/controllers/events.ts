import { Request, Response, NextFunction } from 'express';
import { PrismaClient, EventStatus } from '@prisma/client';
import { AppError } from '../utils/errors';

const prisma = new PrismaClient();

export const createEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      slug, title, description, bannerUrl, status,
      maxTeamSize, minTeamSize, maxRegistrations,
      registrationOpen, registrationClose, eventStart, eventEnd,
      submissionDeadline, timezone, prizePool, tags, isPublic
    } = req.body;

    const organizerId = req.user?.userId;
    if (!organizerId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const existing = await prisma.event.findUnique({ where: { slug } });
    if (existing) {
      throw new AppError('Event slug is already in use', 400, 'SLUG_EXISTS');
    }

    const event = await prisma.event.create({
      data: {
        slug,
        title,
        description,
        bannerUrl,
        organizerId,
        status: status as EventStatus,
        maxTeamSize,
        minTeamSize,
        maxRegistrations,
        registrationOpen: new Date(registrationOpen),
        registrationClose: new Date(registrationClose),
        eventStart: new Date(eventStart),
        eventEnd: new Date(eventEnd),
        submissionDeadline: new Date(submissionDeadline),
        timezone,
        prizePool: prizePool || {},
        tags: tags || [],
        isPublic: isPublic !== undefined ? isPublic : true,
        isActive: true,
      },
    });

    res.status(201).json({ message: 'Event created successfully', event });
  } catch (error) {
    next(error);
  }
};

export const getEvents = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { status, tag, date, sortBy, sortOrder } = req.query;

    const where: any = { isActive: true };

    if (status) {
      where.status = status as EventStatus;
    }

    if (tag) {
      where.tags = { has: tag as string };
    }

    if (date) {
      const filterDate = new Date(date as string);
      where.eventStart = { lte: filterDate };
      where.eventEnd = { gte: filterDate };
    }

    let orderBy: any = { eventStart: 'desc' };
    const order = sortOrder === 'asc' ? 'asc' : 'desc';

    if (sortBy === 'date') {
      orderBy = { eventStart: order };
    } else if (sortBy === 'registrationCount') {
      orderBy = {
        registrations: {
          _count: order,
        },
      };
    }

    const [events, total] = await prisma.$transaction([
      prisma.event.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: {
            select: { registrations: true },
          },
        },
      }),
      prisma.event.count({ where }),
    ]);

    res.status(200).json({
      events,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getEventBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug as string;
    const currentUserId = req.user?.userId;

    const event = await prisma.event.findFirst({
      where: { slug, isActive: true },
      include: {
        _count: {
          select: { registrations: true },
        },
      },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    let registrationStatus = null;
    if (currentUserId) {
      const registration = await prisma.registration.findUnique({
        where: {
          eventId_userId: {
            eventId: event.id,
            userId: currentUserId,
          },
        },
        select: { status: true },
      });
      registrationStatus = registration ? registration.status : null;
    }

    res.status(200).json({
      event,
      registrationStatus,
    });
  } catch (error) {
    next(error);
  }
};

export const updateEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;
    const currentUserRole = req.user?.role;

    const event = await prisma.event.findFirst({ where: { id, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (currentUserRole !== 'ADMIN' && event.organizerId !== currentUserId) {
      throw new AppError('Forbidden: You are not the organizer of this event', 403, 'FORBIDDEN');
    }

    const updateData: any = {};
    const fields = [
      'title', 'description', 'bannerUrl', 'status',
      'maxTeamSize', 'minTeamSize', 'maxRegistrations',
      'timezone', 'prizePool', 'tags', 'isPublic'
    ];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const dateFields = ['registrationOpen', 'registrationClose', 'eventStart', 'eventEnd', 'submissionDeadline'];
    dateFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = new Date(req.body[field]);
      }
    });

    const updatedEvent = await prisma.event.update({
      where: { id: id },
      data: updateData,
    });

    res.status(200).json({ message: 'Event updated successfully', event: updatedEvent });
  } catch (error) {
    next(error);
  }
};

export const deleteEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const event = await prisma.event.findFirst({ where: { id, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    await prisma.event.update({
      where: { id: id },
      data: { isActive: false },
    });

    res.status(200).json({ message: 'Event soft-deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const getEventStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    const event = await prisma.event.findFirst({ where: { id, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (event.organizerId !== currentUserId) {
      throw new AppError('Forbidden: Access limited to the event organizer', 403, 'FORBIDDEN');
    }

    const [registrationsCount, teamsCount, submissionsCount, judgesCount] = await prisma.$transaction([
      prisma.registration.count({ where: { eventId: id } }),
      prisma.team.count({ where: { eventId: id, isActive: true } }),
      prisma.project.count({ where: { eventId: id, status: 'SUBMITTED', isActive: true } }),
      prisma.eventJudge.count({ where: { eventId: id } }),
    ]);

    res.status(200).json({
      stats: {
        registrations: registrationsCount,
        teams: teamsCount,
        submissions: submissionsCount,
        judgesAssigned: judgesCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

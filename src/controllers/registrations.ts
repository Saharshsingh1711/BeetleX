import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/errors';

const prisma = new PrismaClient();

export const registerForEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const userId = req.user?.userId;
    const { registrationData } = req.body;

    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const event = await prisma.event.findFirst({ where: { id: eventId, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (event.status !== 'OPEN' && event.status !== 'ACTIVE') {
      throw new AppError('Registration is not open for this event', 400, 'REGISTRATION_CLOSED');
    }

    const existing = await prisma.registration.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (existing && existing.status !== 'CANCELLED') {
      throw new AppError('You have already registered for this event', 409, 'DUPLICATE_REGISTRATION');
    }

    if (event.maxRegistrations) {
      const currentCount = await prisma.registration.count({
        where: { eventId, status: { not: 'CANCELLED' } },
      });
      if (currentCount >= event.maxRegistrations) {
        throw new AppError('Event has reached maximum registration capacity', 400, 'EVENT_CAPACITY_EXCEEDED');
      }
    }

    const registration = await prisma.registration.upsert({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
      update: {
        status: 'CONFIRMED',
        registrationData: registrationData || {},
        registeredAt: new Date(),
        cancelledAt: null,
      },
      create: {
        eventId,
        userId,
        status: 'CONFIRMED',
        registrationData: registrationData || {},
      },
    });

    res.status(201).json({ message: 'Registered successfully', registration });
  } catch (error) {
    next(error);
  }
};

export const getRegistrationStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const userId = req.user?.userId;

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

    if (!registration) {
      throw new AppError('No registration found for this event', 404, 'REGISTRATION_NOT_FOUND');
    }

    res.status(200).json({ registration });
  } catch (error) {
    next(error);
  }
};

export const cancelRegistration = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const event = await prisma.event.findFirst({ where: { id: eventId, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (new Date() >= event.eventStart) {
      throw new AppError('Cannot cancel registration after the event has started', 400, 'EVENT_ALREADY_STARTED');
    }

    const registration = await prisma.registration.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (!registration || registration.status === 'CANCELLED') {
      throw new AppError('No active registration found to cancel', 404, 'REGISTRATION_NOT_FOUND');
    }

    const updated = await prisma.registration.update({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    res.status(200).json({ message: 'Registration cancelled successfully', registration: updated });
  } catch (error) {
    next(error);
  }
};

export const getEventRegistrationsList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const currentUserId = req.user?.userId;

    const event = await prisma.event.findFirst({ where: { id: eventId, isActive: true } });
    if (!event) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (event.organizerId !== currentUserId && req.user?.role !== 'ADMIN') {
      throw new AppError('Forbidden: Access limited to the event organizer', 403, 'FORBIDDEN');
    }

    const format = req.query.format as string;
    const acceptHeader = req.headers.accept;

    const registrations = await prisma.registration.findMany({
      where: { eventId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            username: true,
          },
        },
      },
      orderBy: { registeredAt: 'desc' },
    });

    if (format === 'csv' || acceptHeader === 'text/csv') {
      let csv = 'Registration ID,User ID,Full Name,Username,Email,Status,Registered At\n';
      registrations.forEach((r) => {
        csv += `"${r.id}","${r.user.id}","${r.user.fullName.replace(/"/g, '""')}","${r.user.username.replace(/"/g, '""')}","${r.user.email}","${r.status}","${r.registeredAt.toISOString()}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=registrations.csv');
      res.status(200).send(csv);
      return;
    }

    res.status(200).json({ registrations });
  } catch (error) {
    next(error);
  }
};

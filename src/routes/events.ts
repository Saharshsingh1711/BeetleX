import { Router } from 'express';
import { z } from 'zod';
import {
  createEvent,
  getEvents,
  getEventBySlug,
  updateEvent,
  deleteEvent,
  getEventStats,
} from '../controllers/events';
import { createTeam, getTeams } from '../controllers/teams';
import { validateMiddleware } from '../middlewares/validate';
import { authenticate, authorize } from '../middlewares/auth';
import registrationsRouter from './registrations';

const router = Router();

const createEventSchema = z.object({
  slug: z.string().min(3).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1),
  description: z.string(),
  bannerUrl: z.string().url().optional().nullable(),
  status: z.enum(['DRAFT', 'OPEN', 'ACTIVE', 'JUDGING', 'CLOSED']),
  maxTeamSize: z.number().int().min(1).default(4),
  minTeamSize: z.number().int().min(1).default(1),
  maxRegistrations: z.number().int().min(1).optional().nullable(),
  registrationOpen: z.string().datetime(),
  registrationClose: z.string().datetime(),
  eventStart: z.string().datetime(),
  eventEnd: z.string().datetime(),
  submissionDeadline: z.string().datetime(),
  timezone: z.string().default('UTC'),
  prizePool: z.any().optional(),
  tags: z.array(z.string()).default([]),
  isPublic: z.boolean().default(true),
}).refine((data) => data.minTeamSize <= data.maxTeamSize, {
  message: 'minTeamSize must be less than or equal to maxTeamSize',
  path: ['minTeamSize'],
});

const updateEventSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  bannerUrl: z.string().url().optional().nullable(),
  status: z.enum(['DRAFT', 'OPEN', 'ACTIVE', 'JUDGING', 'CLOSED']).optional(),
  maxTeamSize: z.number().int().min(1).optional(),
  minTeamSize: z.number().int().min(1).optional(),
  maxRegistrations: z.number().int().min(1).optional().nullable(),
  registrationOpen: z.string().datetime().optional(),
  registrationClose: z.string().datetime().optional(),
  eventStart: z.string().datetime().optional(),
  eventEnd: z.string().datetime().optional(),
  submissionDeadline: z.string().datetime().optional(),
  timezone: z.string().optional(),
  prizePool: z.any().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
});

const eventTeamCreateSchema = z.object({
  name: z.string().min(1),
  track: z.string().min(1).optional().nullable(),
});

router.get('/', getEvents);
router.post('/', authenticate, authorize(['ORGANIZER', 'ADMIN']), validateMiddleware(createEventSchema), createEvent);
router.get('/:slug', getEventBySlug);
router.patch('/:id', authenticate, authorize(['ORGANIZER', 'ADMIN']), validateMiddleware(updateEventSchema), updateEvent);
router.delete('/:id', authenticate, authorize(['ADMIN']), deleteEvent);
router.get('/:id/stats', authenticate, authorize(['ORGANIZER', 'ADMIN']), getEventStats);
router.post('/:id/teams', authenticate, validateMiddleware(eventTeamCreateSchema), createTeam);
router.get('/:id/teams', authenticate, getTeams);
router.use('/:id', registrationsRouter);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import {
  registerForEvent,
  getRegistrationStatus,
  cancelRegistration,
  getEventRegistrationsList,
} from '../controllers/registrations';
import { validateMiddleware } from '../middlewares/validate';
import { authenticate, authorize } from '../middlewares/auth';

const router = Router({ mergeParams: true });

const registerSchema = z.object({
  registrationData: z.object({
    role: z.string().min(1, 'Role at signup is required'),
    skills: z.array(z.string()).default([]),
    experienceLevel: z.string().min(1, 'Experience level is required'),
  }).optional(),
});

router.post('/register', authenticate, validateMiddleware(registerSchema), registerForEvent);
router.get('/registration', authenticate, getRegistrationStatus);
router.delete('/registration', authenticate, cancelRegistration);
router.get('/registrations', authenticate, authorize(['ORGANIZER', 'ADMIN']), getEventRegistrationsList);

export default router;

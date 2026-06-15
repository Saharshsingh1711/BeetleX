import { Router } from 'express';
import { z } from 'zod';
import { register, login, refresh, logout, me, updateProfile } from '../controllers/auth';
import { validateMiddleware } from '../middlewares/validate';
import { authenticate } from '../middlewares/auth';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Full name is required'),
  username: z.string().min(3, 'Username must be at least 3 characters').regex(/^[a-zA-Z0-9_-]+$/, 'Username must be URL safe'),
  avatarUrl: z.string().url('Invalid avatar URL').optional().nullable(),
  bio: z.string().max(500, 'Bio cannot exceed 500 characters').optional().nullable(),
  githubUrl: z.string().url('Invalid GitHub URL').optional().nullable(),
  linkedinUrl: z.string().url('Invalid LinkedIn URL').optional().nullable(),
  role: z.enum(['PARTICIPANT', 'JUDGE', 'ORGANIZER', 'ADMIN']),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const updateProfileSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').optional(),
  avatarUrl: z.string().url('Invalid avatar URL').optional().nullable(),
  bio: z.string().max(500, 'Bio cannot exceed 500 characters').optional().nullable(),
  githubUrl: z.string().url('Invalid GitHub URL').optional().nullable(),
  linkedinUrl: z.string().url('Invalid LinkedIn URL').optional().nullable(),
});

router.post('/register', validateMiddleware(registerSchema), register);
router.post('/login', validateMiddleware(loginSchema), login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.patch('/me', authenticate, validateMiddleware(updateProfileSchema), updateProfile);

export default router;

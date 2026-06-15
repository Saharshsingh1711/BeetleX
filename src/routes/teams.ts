import { Router } from 'express';
import { z } from 'zod';
import {
  getTeamById,
  updateTeam,
  joinTeam,
  removeTeamMember,
  disbandTeam,
} from '../controllers/teams';
import {
  createProjectDraft,
  getTeamProject,
  updateProjectDraft,
} from '../controllers/projects';
import { validateMiddleware } from '../middlewares/validate';
import { authenticate } from '../middlewares/auth';

const router = Router();

const updateTeamSchema = z.object({
  name: z.string().min(1).optional(),
  track: z.string().min(1).optional().nullable(),
  isOpen: z.boolean().optional(),
});

const joinTeamSchema = z.object({
  inviteCode: z.string().length(12).toUpperCase(),
});

const projectSchema = z.object({
  title: z.string().min(1),
  description: z.string().max(2000),
  techStack: z.array(z.string()).default([]),
  demoUrl: z.string().url().optional().nullable(),
  repoUrl: z.string().url().optional().nullable(),
  videoUrl: z.string().url().optional().nullable(),
});

const updateProjectSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().max(2000).optional(),
  techStack: z.array(z.string()).optional(),
  demoUrl: z.string().url().optional().nullable(),
  repoUrl: z.string().url().optional().nullable(),
  videoUrl: z.string().url().optional().nullable(),
});

router.post('/join', authenticate, validateMiddleware(joinTeamSchema), joinTeam);
router.get('/:id', authenticate, getTeamById);
router.patch('/:id', authenticate, validateMiddleware(updateTeamSchema), updateTeam);
router.delete('/:id/members/:userId', authenticate, removeTeamMember);
router.delete('/:id', authenticate, disbandTeam);

router.post('/:id/project', authenticate, validateMiddleware(projectSchema), createProjectDraft);
router.get('/:id/project', authenticate, getTeamProject);
router.patch('/:id/project', authenticate, validateMiddleware(updateProjectSchema), updateProjectDraft);

export default router;

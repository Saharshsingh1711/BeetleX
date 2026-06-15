import { Router } from 'express';
import { z } from 'zod';
import {
  getTeamById,
  updateTeam,
  joinTeam,
  removeTeamMember,
  disbandTeam,
} from '../controllers/teams';
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

router.post('/join', authenticate, validateMiddleware(joinTeamSchema), joinTeam);
router.get('/:id', authenticate, getTeamById);
router.patch('/:id', authenticate, validateMiddleware(updateTeamSchema), updateTeam);
router.delete('/:id/members/:userId', authenticate, removeTeamMember);
router.delete('/:id', authenticate, disbandTeam);

export default router;

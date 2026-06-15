import { Router } from 'express';
import { z } from 'zod';
import {
  getJudgeProjects,
  getJudgeProjectById,
  submitScore,
  updateScore,
} from '../controllers/scores';
import { validateMiddleware } from '../middlewares/validate';
import { authenticate, authorize } from '../middlewares/auth';

const router = Router();

const scoreSchema = z.object({
  innovation: z.number().int().min(1).max(10),
  technical: z.number().int().min(1).max(10),
  impact: z.number().int().min(1).max(10),
  presentation: z.number().int().min(1).max(10),
  comments: z.string().optional().nullable(),
});

const updateScoreSchema = z.object({
  innovation: z.number().int().min(1).max(10).optional(),
  technical: z.number().int().min(1).max(10).optional(),
  impact: z.number().int().min(1).max(10).optional(),
  presentation: z.number().int().min(1).max(10).optional(),
  comments: z.string().optional().nullable(),
});

router.get('/projects', authenticate, authorize(['JUDGE', 'ADMIN']), getJudgeProjects);
router.get('/projects/:id', authenticate, authorize(['JUDGE', 'ADMIN']), getJudgeProjectById);
router.post('/projects/:id/score', authenticate, authorize(['JUDGE', 'ADMIN']), validateMiddleware(scoreSchema), submitScore);
router.patch('/projects/:id/score', authenticate, authorize(['JUDGE', 'ADMIN']), validateMiddleware(updateScoreSchema), updateScore);

export default router;

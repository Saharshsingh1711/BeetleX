import { Router } from 'express';
import { z } from 'zod';
import {
  createAnnouncement,
  publishAnnouncement,
  getAnnouncements,
  markAnnouncementAsRead,
  getUnreadAnnouncementsCount,
} from '../controllers/announcements';
import { validateMiddleware } from '../middlewares/validate';
import { authenticate, authorize } from '../middlewares/auth';

const router = Router({ mergeParams: true });

const createAnnouncementSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  body: z.string().min(1, 'Body content is required'),
  priority: z.enum(['INFO', 'WARNING', 'URGENT']),
  target: z.enum(['ALL', 'PARTICIPANTS', 'JUDGES', 'ORGANIZERS']),
});

router.get('/unread-count', authenticate, getUnreadAnnouncementsCount);
router.get('/', authenticate, getAnnouncements);
router.post('/', authenticate, authorize(['ORGANIZER', 'ADMIN']), validateMiddleware(createAnnouncementSchema), createAnnouncement);
router.post('/:announcementId/publish', authenticate, authorize(['ORGANIZER', 'ADMIN']), publishAnnouncement);
router.post('/:announcementId/read', authenticate, markAnnouncementAsRead);

export default router;

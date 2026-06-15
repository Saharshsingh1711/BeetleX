// Define mock variables first
var mockUser = {
  findUnique: jest.fn(),
};
var mockEvent = {
  findFirst: jest.fn(),
};
var mockAnnouncement = {
  create: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
  count: jest.fn(),
};
var mockAnnouncementRead = {
  upsert: jest.fn(),
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        user: mockUser,
        event: mockEvent,
        announcement: mockAnnouncement,
        announcementRead: mockAnnouncementRead,
        $transaction: (promises: any) => Promise.all(promises),
      };
    }),
  };
});

import request from 'supertest';
import app from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';

const organizerToken = generateAccessToken({ userId: 'org-123', email: 'org@beetlex.com', role: 'ORGANIZER' });
const participantToken = generateAccessToken({ userId: 'part-123', email: 'part@beetlex.com', role: 'PARTICIPANT' });
const judgeToken = generateAccessToken({ userId: 'judge-123', email: 'judge@beetlex.com', role: 'JUDGE' });

describe('Announcements API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/events/:id/announcements', () => {
    it('should allow organizer to create announcement draft', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });
      mockAnnouncement.create.mockResolvedValueOnce({
        id: 'ann-123',
        title: 'New Announcement',
        body: 'Details here',
        priority: 'INFO',
        target: 'ALL',
        isPublished: false,
      });

      const response = await request(app)
        .post('/api/events/event-123/announcements')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'New Announcement',
          body: 'Details here',
          priority: 'INFO',
          target: 'ALL',
        });

      expect(response.status).toBe(201);
      expect(response.body.announcement.isPublished).toBe(false);
      expect(response.body.announcement.title).toBe('New Announcement');
    });

    it('should block non-organizers from creating drafts', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });

      const response = await request(app)
        .post('/api/events/event-123/announcements')
        .set('Authorization', `Bearer ${participantToken}`)
        .send({
          title: 'New Announcement',
          body: 'Details here',
          priority: 'INFO',
          target: 'ALL',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/events/:id/announcements/:announcementId/publish', () => {
    it('should allow organizer to publish draft', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });
      mockAnnouncement.findFirst.mockResolvedValueOnce({
        id: 'ann-123',
        eventId: 'event-123',
        isPublished: false,
      });
      mockAnnouncement.update.mockResolvedValueOnce({
        id: 'ann-123',
        isPublished: true,
        publishedAt: new Date(),
      });

      const response = await request(app)
        .post('/api/events/event-123/announcements/ann-123/publish')
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.announcement.isPublished).toBe(true);
    });

    it('should block double-publishing', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });
      mockAnnouncement.findFirst.mockResolvedValueOnce({
        id: 'ann-123',
        eventId: 'event-123',
        isPublished: true, // Already published
      });

      const response = await request(app)
        .post('/api/events/event-123/announcements/ann-123/publish')
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('ALREADY_PUBLISHED');
    });
  });

  describe('GET /api/events/:id/announcements', () => {
    it('should return all drafts and published announcements to organizer', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });
      mockAnnouncement.findMany.mockResolvedValueOnce([
        {
          id: 'ann-123',
          title: 'Draft',
          body: 'Content',
          priority: 'INFO',
          target: 'ALL',
          isPublished: false,
          createdAt: new Date(),
          reads: [],
        },
        {
          id: 'ann-456',
          title: 'Published',
          body: 'Content',
          priority: 'WARNING',
          target: 'ALL',
          isPublished: true,
          publishedAt: new Date(),
          createdAt: new Date(),
          reads: [],
        },
      ]);

      const response = await request(app)
        .get('/api/events/event-123/announcements')
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.announcements).toHaveLength(2);
    });

    it('should return only targeted, published announcements to participant', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });
      mockAnnouncement.findMany.mockResolvedValueOnce([
        {
          id: 'ann-456',
          title: 'Published',
          body: 'Content',
          priority: 'WARNING',
          target: 'ALL',
          isPublished: true,
          publishedAt: new Date(),
          createdAt: new Date(),
          reads: [],
        },
      ]);

      const response = await request(app)
        .get('/api/events/event-123/announcements')
        .set('Authorization', `Bearer ${participantToken}`);

      expect(response.status).toBe(200);
      expect(response.body.announcements).toHaveLength(1);
      expect(response.body.announcements[0].title).toBe('Published');
    });
  });

  describe('POST /api/events/:id/announcements/:announcementId/read', () => {
    it('should create a read receipt for target audience', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });
      mockAnnouncement.findFirst.mockResolvedValueOnce({
        id: 'ann-456',
        eventId: 'event-123',
        target: 'ALL',
        isPublished: true,
      });
      mockAnnouncementRead.upsert.mockResolvedValueOnce({});

      const response = await request(app)
        .post('/api/events/event-123/announcements/ann-456/read')
        .set('Authorization', `Bearer ${participantToken}`);

      expect(response.status).toBe(200);
    });

    it('should block reading unpublished announcement', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });
      mockAnnouncement.findFirst.mockResolvedValueOnce({
        id: 'ann-456',
        eventId: 'event-123',
        target: 'ALL',
        isPublished: false, // Unpublished
      });

      const response = await request(app)
        .post('/api/events/event-123/announcements/ann-456/read')
        .set('Authorization', `Bearer ${participantToken}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('UNPUBLISHED_ANNOUNCEMENT');
    });

    it('should block reading announcement targeting a different group', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true,
      });
      mockAnnouncement.findFirst.mockResolvedValueOnce({
        id: 'ann-456',
        eventId: 'event-123',
        target: 'JUDGES', // Targets JUDGES only
        isPublished: true,
      });

      const response = await request(app)
        .post('/api/events/event-123/announcements/ann-456/read')
        .set('Authorization', `Bearer ${participantToken}`); // PARTICIPANT

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/events/:id/announcements/unread-count', () => {
    it('should return unread count', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        isActive: true,
      });
      mockAnnouncement.count.mockResolvedValueOnce(3);

      const response = await request(app)
        .get('/api/events/event-123/announcements/unread-count')
        .set('Authorization', `Bearer ${participantToken}`);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(3);
    });
  });
});

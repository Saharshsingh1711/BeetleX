var mockUser = {
  findUnique: jest.fn(),
};
var mockEvent = {
  findUnique: jest.fn(),
  create: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
};
var mockRegistration = {
  findUnique: jest.fn(),
  count: jest.fn(),
};
var mockTeam = {
  count: jest.fn(),
};
var mockProject = {
  count: jest.fn(),
};
var mockEventJudge = {
  count: jest.fn(),
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        user: mockUser,
        event: mockEvent,
        registration: mockRegistration,
        team: mockTeam,
        project: mockProject,
        eventJudge: mockEventJudge,
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

describe('Events API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/events', () => {
    it('should allow organizers to create a new event', async () => {
      mockEvent.findUnique.mockResolvedValueOnce(null); // Slug check
      mockEvent.create.mockResolvedValue({
        id: 'event-id',
        slug: 'hack-2026',
        title: 'Hackathon 2026',
        organizerId: 'org-123',
      });

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          slug: 'hack-2026',
          title: 'Hackathon 2026',
          description: 'A great event',
          status: 'DRAFT',
          registrationOpen: new Date().toISOString(),
          registrationClose: new Date().toISOString(),
          eventStart: new Date().toISOString(),
          eventEnd: new Date().toISOString(),
          submissionDeadline: new Date().toISOString(),
        });

      expect(response.status).toBe(201);
      expect(response.body.event.slug).toBe('hack-2026');
    });

    it('should forbid participants from creating events', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${participantToken}`)
        .send({
          slug: 'hack-2026',
          title: 'Hackathon 2026',
        });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/events', () => {
    it('should return paginated events', async () => {
      mockEvent.findMany.mockResolvedValueOnce([
        { id: 'event-1', slug: 'hack-1', title: 'Hack 1' },
      ]);
      mockEvent.count.mockResolvedValueOnce(1);

      const response = await request(app).get('/api/events?page=1&limit=5');
      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      expect(response.body.meta.totalPages).toBe(1);
    });
  });
});

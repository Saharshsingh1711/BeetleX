// Define mock variables first
var mockUser = {
  findUnique: jest.fn(),
};
var mockEvent = {
  findFirst: jest.fn(),
};
var mockTeam = {
  findFirst: jest.fn(),
};
var mockProject = {
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  findMany: jest.fn(),
};
var mockEventJudge = {
  findUnique: jest.fn(),
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        user: mockUser,
        event: mockEvent,
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

const leaderToken = generateAccessToken({ userId: 'leader-123', email: 'leader@beetlex.com', role: 'PARTICIPANT' });
const memberToken = generateAccessToken({ userId: 'member-123', email: 'member@beetlex.com', role: 'PARTICIPANT' });

describe('Projects API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/teams/:id/project', () => {
    it('should allow team leader to create project draft', async () => {
      mockTeam.findFirst.mockResolvedValueOnce({
        id: 'team-123',
        eventId: 'event-123',
        leaderId: 'leader-123',
        isActive: true,
      });
      mockProject.findUnique.mockResolvedValueOnce(null); // No existing project
      mockProject.create.mockResolvedValue({
        id: 'proj-123',
        title: 'BeetleX Platform',
        status: 'DRAFT',
      });

      const response = await request(app)
        .post('/api/teams/team-123/project')
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          title: 'BeetleX Platform',
          description: 'A great platform',
        });

      expect(response.status).toBe(201);
      expect(response.body.project.title).toBe('BeetleX Platform');
    });

    it('should reject draft creation if user is not the leader', async () => {
      mockTeam.findFirst.mockResolvedValueOnce({
        id: 'team-123',
        eventId: 'event-123',
        leaderId: 'leader-123',
        isActive: true,
      });

      const response = await request(app)
        .post('/api/teams/team-123/project')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          title: 'BeetleX Platform',
          description: 'A great platform',
        });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/projects/:id/submit', () => {
    it('should allow leader to submit before deadline', async () => {
      mockProject.findFirst.mockResolvedValueOnce({
        id: 'proj-123',
        team: { leaderId: 'leader-123' },
        event: { submissionDeadline: new Date(Date.now() + 100000) }, // Future
        isActive: true,
      });
      mockProject.update.mockResolvedValue({
        id: 'proj-123',
        status: 'SUBMITTED',
      });

      const response = await request(app)
        .post('/api/projects/proj-123/submit')
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(response.status).toBe(200);
      expect(response.body.project.status).toBe('SUBMITTED');
    });

    it('should block submission after deadline', async () => {
      mockProject.findFirst.mockResolvedValueOnce({
        id: 'proj-123',
        team: { leaderId: 'leader-123' },
        event: { submissionDeadline: new Date(Date.now() - 100000) }, // Past
        isActive: true,
      });

      const response = await request(app)
        .post('/api/projects/proj-123/submit')
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('SUBMISSION_DEADLINE_PASSED');
    });
  });

  describe('POST /api/projects/:id/deck', () => {
    it('should upload PDF successfully (mock S3)', async () => {
      mockProject.findFirst.mockResolvedValueOnce({
        id: 'proj-123',
        team: { leaderId: 'leader-123' },
        isActive: true,
      });
      mockProject.update.mockResolvedValue({
        id: 'proj-123',
        deckUrl: 'https://s3.amazonaws.com/beetlex-decks/deck-proj-123.pdf',
      });

      const buffer = Buffer.from('%PDF-1.4 dummy pdf content');
      const response = await request(app)
        .post('/api/projects/proj-123/deck')
        .set('Authorization', `Bearer ${leaderToken}`)
        .attach('deck', buffer, { filename: 'pitch.pdf', contentType: 'application/pdf' });

      expect(response.status).toBe(200);
      expect(response.body.deckUrl).toContain('s3.amazonaws.com');
    });
  });
});

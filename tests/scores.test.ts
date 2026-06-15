// Define mock variables first
var mockUser = {
  findUnique: jest.fn(),
};
var mockEvent = {
  findFirst: jest.fn(),
};
var mockProject = {
  findMany: jest.fn(),
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
};
var mockEventJudge = {
  findMany: jest.fn(),
  findFirst: jest.fn(),
};
var mockScore = {
  findUnique: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        user: mockUser,
        event: mockEvent,
        project: mockProject,
        eventJudge: mockEventJudge,
        score: mockScore,
        $transaction: (promises: any) => Promise.all(promises),
      };
    }),
    Prisma: {
      Decimal: jest.fn().mockImplementation((val) => val),
    },
  };
});

import request from 'supertest';
import app from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';

const judgeToken = generateAccessToken({ userId: 'judge-123', email: 'judge@beetlex.com', role: 'JUDGE' });
const organizerToken = generateAccessToken({ userId: 'org-123', email: 'org@beetlex.com', role: 'ORGANIZER' });
const participantToken = generateAccessToken({ userId: 'part-123', email: 'part@beetlex.com', role: 'PARTICIPANT' });
const adminToken = generateAccessToken({ userId: 'admin-123', email: 'admin@beetlex.com', role: 'ADMIN' });

describe('Scores & Judging API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/judge/projects', () => {
    it('should return projects assigned to the judge', async () => {
      mockEventJudge.findMany.mockResolvedValueOnce([
        { eventId: 'event-123', track: 'Web' }
      ]);
      mockProject.findMany.mockResolvedValueOnce([
        {
          id: 'proj-123',
          title: 'Project Web',
          description: 'A Web App',
          techStack: ['React'],
          demoUrl: null,
          repoUrl: null,
          videoUrl: null,
          deckUrl: null,
          submittedAt: new Date(),
          team: { name: 'Team Web', track: 'Web' },
          scores: []
        }
      ]);

      const response = await request(app)
        .get('/api/judge/projects')
        .set('Authorization', `Bearer ${judgeToken}`);

      expect(response.status).toBe(200);
      expect(response.body.projects).toHaveLength(1);
      expect(response.body.projects[0].title).toBe('Project Web');
      expect(response.body.projects[0].reviewStatus).toBe('PENDING');
    });

    it('should reject requests from non-judges', async () => {
      const response = await request(app)
        .get('/api/judge/projects')
        .set('Authorization', `Bearer ${participantToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/judge/projects/:id', () => {
    it('should return project details if judge is assigned', async () => {
      mockProject.findFirst.mockResolvedValueOnce({
        id: 'proj-123',
        eventId: 'event-123',
        title: 'Project Web',
        description: 'A Web App',
        techStack: ['React'],
        team: { name: 'Team Web', track: 'Web' },
        scores: []
      });
      mockEventJudge.findFirst.mockResolvedValueOnce({
        id: 'ej-123'
      });

      const response = await request(app)
        .get('/api/judge/projects/proj-123')
        .set('Authorization', `Bearer ${judgeToken}`);

      expect(response.status).toBe(200);
      expect(response.body.project.title).toBe('Project Web');
    });

    it('should reject detailed lookup if judge is not assigned', async () => {
      mockProject.findFirst.mockResolvedValueOnce({
        id: 'proj-123',
        eventId: 'event-123',
        title: 'Project Web',
        description: 'A Web App',
        techStack: ['React'],
        team: { name: 'Team Web', track: 'Web' },
        scores: []
      });
      mockEventJudge.findFirst.mockResolvedValueOnce(null); // Not assigned to this track/event

      const response = await request(app)
        .get('/api/judge/projects/proj-123')
        .set('Authorization', `Bearer ${judgeToken}`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/judge/projects/:id/score', () => {
    it('should allow score submission with valid parameters', async () => {
      mockProject.findFirst.mockResolvedValueOnce({
        id: 'proj-123',
        eventId: 'event-123',
        team: { track: 'Web' }
      });
      mockEventJudge.findFirst.mockResolvedValueOnce({ id: 'ej-123' });
      mockScore.findUnique.mockResolvedValueOnce(null);
      mockScore.create.mockResolvedValueOnce({
        id: 'score-123',
        innovation: 8,
        technical: 9,
        impact: 7,
        presentation: 8,
        total: 8.0
      });

      const response = await request(app)
        .post('/api/judge/projects/proj-123/score')
        .set('Authorization', `Bearer ${judgeToken}`)
        .send({
          innovation: 8,
          technical: 9,
          impact: 7,
          presentation: 8,
          comments: 'Nice job!'
        });

      expect(response.status).toBe(201);
      expect(response.body.score.total).toBe(8.0);
    });

    it('should validate score values are between 1 and 10', async () => {
      const response = await request(app)
        .post('/api/judge/projects/proj-123/score')
        .set('Authorization', `Bearer ${judgeToken}`)
        .send({
          innovation: 11, // Invalid
          technical: 9,
          impact: 7,
          presentation: 0, // Invalid
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject score submission if score already exists', async () => {
      mockProject.findFirst.mockResolvedValueOnce({
        id: 'proj-123',
        eventId: 'event-123',
        team: { track: 'Web' }
      });
      mockEventJudge.findFirst.mockResolvedValueOnce({ id: 'ej-123' });
      mockScore.findUnique.mockResolvedValueOnce({ id: 'score-123' });

      const response = await request(app)
        .post('/api/judge/projects/proj-123/score')
        .set('Authorization', `Bearer ${judgeToken}`)
        .send({
          innovation: 8,
          technical: 9,
          impact: 7,
          presentation: 8
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('SCORE_ALREADY_EXISTS');
    });
  });

  describe('PATCH /api/judge/projects/:id/score', () => {
    it('should allow score update', async () => {
      mockScore.findUnique.mockResolvedValueOnce({
        id: 'score-123',
        innovation: 8,
        technical: 9,
        impact: 7,
        presentation: 8,
        project: {
          event: { status: 'JUDGING' }
        }
      });
      mockScore.update.mockResolvedValueOnce({
        id: 'score-123',
        innovation: 9,
        technical: 9,
        impact: 7,
        presentation: 8,
        total: 8.25
      });

      const response = await request(app)
        .patch('/api/judge/projects/proj-123/score')
        .set('Authorization', `Bearer ${judgeToken}`)
        .send({
          innovation: 9
        });

      expect(response.status).toBe(200);
      expect(response.body.score.innovation).toBe(9);
      expect(response.body.score.total).toBe(8.25);
    });

    it('should block score update if the event has closed', async () => {
      mockScore.findUnique.mockResolvedValueOnce({
        id: 'score-123',
        innovation: 8,
        technical: 9,
        impact: 7,
        presentation: 8,
        project: {
          event: { status: 'CLOSED' } // CLOSED event
        }
      });

      const response = await request(app)
        .patch('/api/judge/projects/proj-123/score')
        .set('Authorization', `Bearer ${judgeToken}`)
        .send({
          innovation: 9
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('EVENT_CLOSED');
    });
  });

  describe('GET /api/events/:id/scores', () => {
    it('should return all scores if requester is the organizer', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-123',
        isActive: true
      });
      mockScore.findMany.mockResolvedValueOnce([
        {
          id: 'score-123',
          total: 8.5,
          project: { title: 'Project 1', team: { name: 'Team 1' } },
          judge: { id: 'judge-123', fullName: 'Judge A' }
        }
      ]);

      const response = await request(app)
        .get('/api/events/event-123/scores')
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.scores).toHaveLength(1);
      expect(response.body.scores[0].total).toBe(8.5);
    });

    it('should reject request if requester is not organizer or admin', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        organizerId: 'org-456', // Different organizer
        isActive: true
      });

      const response = await request(app)
        .get('/api/events/event-123/scores')
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(response.status).toBe(403);
    });
  });
});

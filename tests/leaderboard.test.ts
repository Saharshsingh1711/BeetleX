// Define mock variables first
var mockEvent = {
  findFirst: jest.fn(),
};
var mockProject = {
  findMany: jest.fn(),
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        event: mockEvent,
        project: mockProject,
      };
    }),
  };
});

import request from 'supertest';
import app from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';
import { appEmitter, EVENTS } from '../src/utils/emitter';

const participantToken = generateAccessToken({ userId: 'part-123', email: 'part@beetlex.com', role: 'PARTICIPANT' });

describe('Leaderboard API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/events/:id/leaderboard', () => {
    it('should return projects sorted by average score and tie-broken by submission time', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        isActive: true,
      });

      const date1 = new Date('2026-06-15T12:00:00Z');
      const date2 = new Date('2026-06-15T13:00:00Z');
      const date3 = new Date('2026-06-15T14:00:00Z');

      mockProject.findMany.mockResolvedValueOnce([
        {
          id: 'proj-A',
          title: 'Project A',
          submittedAt: date1,
          createdAt: date1,
          team: { name: 'Team A', track: 'Web' },
          scores: [
            { total: 8.0 },
            { total: 9.0 }, // Avg: 8.5
          ],
        },
        {
          id: 'proj-B',
          title: 'Project B',
          submittedAt: date2, // Later than A
          createdAt: date2,
          team: { name: 'Team B', track: 'Web' },
          scores: [
            { total: 8.0 },
            { total: 9.0 }, // Avg: 8.5
          ],
        },
        {
          id: 'proj-C',
          title: 'Project C',
          submittedAt: date3,
          createdAt: date3,
          team: { name: 'Team C', track: 'AI' },
          scores: [
            { total: 9.0 },
            { total: 10.0 }, // Avg: 9.5
          ],
        },
        {
          id: 'proj-D',
          title: 'Project D',
          submittedAt: date3,
          createdAt: date3,
          team: { name: 'Team D', track: 'AI' },
          scores: [], // Avg: 0
        },
      ]);

      const response = await request(app)
        .get('/api/events/event-123/leaderboard')
        .set('Authorization', `Bearer ${participantToken}`);

      expect(response.status).toBe(200);
      const leaderboard = response.body.leaderboard;
      expect(leaderboard).toHaveLength(4);

      // Verify sorting: C (9.5) -> A (8.5, date1) -> B (8.5, date2) -> D (0)
      expect(leaderboard[0].projectId).toBe('proj-C');
      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[0].averageScore).toBe(9.5);

      expect(leaderboard[1].projectId).toBe('proj-A');
      expect(leaderboard[1].rank).toBe(2);
      expect(leaderboard[1].averageScore).toBe(8.5);

      expect(leaderboard[2].projectId).toBe('proj-B');
      expect(leaderboard[2].rank).toBe(3);
      expect(leaderboard[2].averageScore).toBe(8.5);

      expect(leaderboard[3].projectId).toBe('proj-D');
      expect(leaderboard[3].rank).toBe(4);
      expect(leaderboard[3].averageScore).toBe(0);
    });

    it('should return 404 if event is not found', async () => {
      mockEvent.findFirst.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/events/event-123/leaderboard')
        .set('Authorization', `Bearer ${participantToken}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('EVENT_NOT_FOUND');
    });
  });

  describe('GET /api/events/:id/leaderboard/live', () => {
    it('should set up SSE stream headers and write initial data', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        isActive: true,
      });
      mockProject.findMany.mockResolvedValueOnce([]);

      // Test using mocks of express Request & Response
      const reqMock = { params: { id: 'event-123' }, on: jest.fn() } as any;
      const resMock = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as any;

      const { getLiveLeaderboard } = require('../src/controllers/leaderboard');
      await getLiveLeaderboard(reqMock, resMock, jest.fn());

      expect(resMock.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(resMock.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(resMock.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(resMock.write).toHaveBeenCalled();
    });
  });
});

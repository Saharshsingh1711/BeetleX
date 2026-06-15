// Define mock variables first
var mockUser = {
  findUnique: jest.fn(),
};
var mockEvent = {
  findFirst: jest.fn(),
};
var mockRegistration = {
  findUnique: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};
var mockTeam = {
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
};
var mockTeamMember = {
  create: jest.fn(),
  count: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  findUnique: jest.fn(),
};

const prismaMockInstance = {
  team: mockTeam,
  teamMember: mockTeamMember,
  registration: mockRegistration,
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        user: mockUser,
        event: mockEvent,
        registration: mockRegistration,
        team: mockTeam,
        teamMember: mockTeamMember,
        $transaction: (arg: any) => {
          if (typeof arg === 'function') {
            return arg(prismaMockInstance);
          }
          return Promise.all(arg);
        },
      };
    }),
  };
});

import request from 'supertest';
import app from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';

const participantToken = generateAccessToken({ userId: 'part-123', email: 'part@beetlex.com', role: 'PARTICIPANT' });

describe('Teams API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/events/:id/teams', () => {
    it('should successfully create a team for a confirmed registrant', async () => {
      mockRegistration.findUnique.mockResolvedValueOnce({
        eventId: 'event-123',
        userId: 'part-123',
        status: 'CONFIRMED',
        teamId: null,
      });
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        isActive: true,
      });
      mockTeam.findUnique.mockResolvedValueOnce(null); // Name check
      mockTeam.create.mockResolvedValue({
        id: 'team-123',
        name: 'The Winners',
        inviteCode: 'INVITE123456',
        leaderId: 'part-123',
      });

      const response = await request(app)
        .post('/api/events/event-123/teams')
        .set('Authorization', `Bearer ${participantToken}`)
        .send({
          name: 'The Winners',
          track: 'Web3',
        });

      expect(response.status).toBe(201);
      expect(response.body.team.name).toBe('The Winners');
      expect(response.body.team.inviteCode).toBe('INVITE123456');
    });

    it('should return 403 if user registration is not confirmed', async () => {
      mockRegistration.findUnique.mockResolvedValueOnce({
        eventId: 'event-123',
        userId: 'part-123',
        status: 'PENDING',
      });

      const response = await request(app)
        .post('/api/events/event-123/teams')
        .set('Authorization', `Bearer ${participantToken}`)
        .send({
          name: 'The Winners',
        });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/teams/join', () => {
    it('should join team via invite code', async () => {
      mockTeam.findFirst.mockResolvedValueOnce({
        id: 'team-123',
        eventId: 'event-123',
        inOpen: true,
        event: { maxTeamSize: 4 },
      });
      mockRegistration.findUnique.mockResolvedValueOnce({
        status: 'CONFIRMED',
        teamId: null,
      });
      mockTeamMember.count.mockResolvedValueOnce(2); // Fits size limit
      mockTeamMember.create.mockResolvedValue({
        teamId: 'team-123',
        userId: 'part-123',
        role: 'MEMBER',
      });

      const response = await request(app)
        .post('/api/teams/join')
        .set('Authorization', `Bearer ${participantToken}`)
        .send({
          inviteCode: 'INVITE123456',
        });

      expect(response.status).toBe(200);
      expect(response.body.teamId).toBe('team-123');
    });
  });
});

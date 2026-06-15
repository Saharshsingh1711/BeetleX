// Define mock variables first
var mockUser = {
  findUnique: jest.fn(),
};
var mockEvent = {
  findFirst: jest.fn(),
};
var mockRegistration = {
  findUnique: jest.fn(),
  count: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(),
  findMany: jest.fn(),
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        user: mockUser,
        event: mockEvent,
        registration: mockRegistration,
        $transaction: (promises: any) => Promise.all(promises),
      };
    }),
  };
});

import request from 'supertest';
import app from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';

const participantToken = generateAccessToken({ userId: 'part-123', email: 'part@beetlex.com', role: 'PARTICIPANT' });

describe('Registrations API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/events/:id/register', () => {
    it('should successfully register a user for an open event', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        status: 'OPEN',
        maxRegistrations: 100,
        eventStart: new Date(Date.now() + 1000000), // In future
      });
      mockRegistration.findUnique.mockResolvedValueOnce(null); // No previous registration
      mockRegistration.count.mockResolvedValueOnce(50); // Under capacity
      mockRegistration.upsert.mockResolvedValue({
        id: 'reg-uuid',
        eventId: 'event-123',
        userId: 'part-123',
        status: 'CONFIRMED',
      });

      const response = await request(app)
        .post('/api/events/event-123/register')
        .set('Authorization', `Bearer ${participantToken}`)
        .send({
          registrationData: {
            role: 'Developer',
            skills: ['Node', 'React'],
            experienceLevel: 'Intermediate',
          },
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message', 'Registered successfully');
      expect(response.body.registration.status).toBe('CONFIRMED');
    });

    it('should return 409 Conflict if registration already exists', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        status: 'OPEN',
        maxRegistrations: 100,
        eventStart: new Date(Date.now() + 1000000),
      });
      mockRegistration.findUnique.mockResolvedValueOnce({
        id: 'reg-uuid',
        eventId: 'event-123',
        userId: 'part-123',
        status: 'CONFIRMED',
      });

      const response = await request(app)
        .post('/api/events/event-123/register')
        .set('Authorization', `Bearer ${participantToken}`)
        .send({
          registrationData: {
            role: 'Developer',
            skills: ['Node'],
            experienceLevel: 'Junior',
          },
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('DUPLICATE_REGISTRATION');
    });
  });

  describe('DELETE /api/events/:id/registration', () => {
    it('should return 400 if user tries to cancel after event started', async () => {
      mockEvent.findFirst.mockResolvedValueOnce({
        id: 'event-123',
        status: 'ACTIVE',
        eventStart: new Date(Date.now() - 100000), // In past (already started)
      });

      const response = await request(app)
        .delete('/api/events/event-123/registration')
        .set('Authorization', `Bearer ${participantToken}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('EVENT_ALREADY_STARTED');
    });
  });
});

// Define mock variables first using var for hosting
var mockUser = {
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};
var mockRefreshToken = {
  create: jest.fn(),
  findUnique: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        user: mockUser,
        refreshToken: mockRefreshToken,
      };
    }),
  };
});

import request from 'supertest';
import app from '../src/app';
import bcrypt from 'bcrypt';

describe('Authentication API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should successfully register a new user', async () => {
      mockUser.findUnique.mockResolvedValueOnce(null); // No email exists
      mockUser.findUnique.mockResolvedValueOnce(null); // No username exists
      mockUser.create.mockResolvedValue({
        id: 'user-uuid',
        email: 'test@beetlex.com',
        fullName: 'Test User',
        username: 'testuser',
        role: 'PARTICIPANT',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@beetlex.com',
          password: 'securepassword123',
          fullName: 'Test User',
          username: 'testuser',
          role: 'PARTICIPANT',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message');
      expect(response.body.user).toEqual({
        id: 'user-uuid',
        email: 'test@beetlex.com',
        fullName: 'Test User',
        username: 'testuser',
        role: 'PARTICIPANT',
      });
    });

    it('should fail registration with invalid request body', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'short',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login user and return access token with cookie', async () => {
      const passwordHash = await bcrypt.hash('securepassword123', 12);
      mockUser.findUnique.mockResolvedValue({
        id: 'user-uuid',
        email: 'test@beetlex.com',
        passwordHash,
        fullName: 'Test User',
        username: 'testuser',
        role: 'PARTICIPANT',
        isActive: true,
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@beetlex.com',
          password: 'securepassword123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.headers['set-cookie'][0]).toContain('refreshToken');
    });

    it('should reject login with wrong password', async () => {
      const passwordHash = await bcrypt.hash('securepassword123', 12);
      mockUser.findUnique.mockResolvedValue({
        id: 'user-uuid',
        email: 'test@beetlex.com',
        passwordHash,
        fullName: 'Test User',
        username: 'testuser',
        role: 'PARTICIPANT',
        isActive: true,
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@beetlex.com',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 when no token is provided', async () => {
      const response = await request(app).get('/api/auth/me');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });
  });
});

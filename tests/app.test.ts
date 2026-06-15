import request from 'supertest';
import app from '../src/app';

describe('GET /health', () => {
  it('should return 200 OK and health status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'OK');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('uptime');
  });

  it('should return 404 for unknown endpoints', async () => {
    const response = await request(app).get('/invalid-route-xyz');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not Found' });
  });
});

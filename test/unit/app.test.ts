import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

const app = createApp();

describe('HTTP basics', () => {
  it('answers the health check', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns field errors in the agreed format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining(['firstName', 'email', 'password', 'acceptTerms']),
    );
  });

  it('requires a token for customer routes', async () => {
    const res = await request(app).get('/api/v1/orders');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects refresh without the CSRF header', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(403);
  });

  it('returns 404 in the error format for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

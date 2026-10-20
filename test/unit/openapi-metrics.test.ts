import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

const app = createApp();

describe('OpenAPI', () => {
  it('describes routes, parameters, bodies and security from the code', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const { paths } = res.body;

    const register = paths['/api/v1/auth/register'].post;
    expect(register.requestBody.content['application/json'].schema.required).toEqual(
      expect.arrayContaining(['firstName', 'email', 'password', 'acceptTerms']),
    );
    expect(register.security).toBeUndefined();

    const order = paths['/api/v1/orders/{publicId}'].get;
    expect(order.security).toEqual([{ bearerAuth: [] }]);
    expect(order.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'publicId', in: 'path' })]),
    );

    expect(paths['/api/v1/partner/venues/{venueId}/logo'].post.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(paths['/api/v1/recommendations'].get.security).toEqual([{}, { bearerAuth: [] }]);
    expect(paths['/api/v1/listings'].get.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['lat', 'lng', 'radiusKm', 'sort']),
    );
  });
});

describe('metrics', () => {
  it('is hidden without the metrics token', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(404);
  });
});

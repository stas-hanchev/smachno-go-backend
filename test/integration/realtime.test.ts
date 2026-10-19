import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { setRealtimeEmitter } from '../../src/lib/realtime.js';
import { attachRealtime } from '../../src/realtime/socket.js';
import { createDictionaries, createUser, createVenueWithListing, resetDb } from './fixtures.js';

let httpServer: HttpServer;
let url: string;
const sockets: Socket[] = [];

function open(token?: string): Promise<Socket> {
  const socket = connect(url, {
    transports: ['websocket'],
    auth: token ? { token } : {},
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function next<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${event} event`)), 5_000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const ack = (socket: Socket, event: string, payload: unknown) =>
  socket.timeout(5_000).emitWithAck(event, payload) as Promise<{ ok: boolean; error?: string }>;

beforeAll(async () => {
  httpServer = createServer(createApp());
  const io = attachRealtime(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  return async () => {
    setRealtimeEmitter(null);
    await io.close();
  };
});

afterAll(() => {
  for (const socket of sockets) socket.disconnect();
});

describe('socket.io', () => {
  it('pushes listing, order and venue events to the right rooms', async () => {
    await resetDb();
    const { city, category } = await createDictionaries();
    const owner = await createUser();
    const { venue, listing } = await createVenueWithListing({
      ownerId: owner.user.id,
      cityId: city.id,
      categoryId: category.id,
      slug: 'live-cafe',
      lat: 50.45,
      lng: 30.52,
      quantity: 3,
    });
    const buyer = await createUser();
    const stranger = await createUser();

    await expect(open('not-a-token')).rejects.toThrow('UNAUTHORIZED');

    const guest = await open();
    expect(await ack(guest, 'listing:subscribe', { listingIds: [Number(listing.id)] })).toEqual({
      ok: true,
    });
    expect(await ack(guest, 'venue:subscribe', { venueId: Number(venue.id) })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });

    const outsider = await open(stranger.token);
    expect(await ack(outsider, 'venue:subscribe', { venueId: Number(venue.id) })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });

    const staff = await open(owner.token);
    expect(await ack(staff, 'venue:subscribe', { venueId: Number(venue.id) })).toEqual({
      ok: true,
    });
    const customer = await open(buyer.token);

    const listingUpdate = next<{ listingId: number; quantityLeft: number }>(
      guest,
      'listing:updated',
    );
    const created = await request(httpServer)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ listingId: Number(listing.id), quantity: 2 });
    expect(created.status).toBe(201);
    expect(await listingUpdate).toMatchObject({ listingId: Number(listing.id), quantityLeft: 1 });

    const newOrder = next<{ publicId: string }>(staff, 'order:new');
    const status = next<{ status: string }>(customer, 'order:status');
    const notification = next<{ type: string }>(customer, 'notification:new');
    let leaked = false;
    outsider.on('order:new', () => {
      leaked = true;
    });
    await request(httpServer)
      .post(created.body.payment.checkoutUrl)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({});

    expect((await newOrder).publicId).toBe(created.body.order.publicId);
    expect((await status).status).toBe('paid');
    expect((await notification).type).toBe('order_paid');
    expect(leaked).toBe(false);
  });
});

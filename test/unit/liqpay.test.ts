import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/lib/money.js';
import {
  decodeLiqpayData,
  encodeLiqpayData,
  liqpayExpiredDate,
  liqpaySignature,
  liqpayState,
  verifyLiqpaySignature,
} from '../../src/modules/payments/liqpay.js';
import { LiqpayGateway, liqpayStatusFromPayload } from '../../src/modules/payments/provider.js';

describe('LiqPay signature', () => {
  it('matches the example from the callback documentation', () => {
    expect(liqpaySignature('base64_post_string', 'your_private_key')).toBe(
      'tp+ZLmKm1/E83dIzUpx5ljcttP4=',
    );
    expect(
      verifyLiqpaySignature(
        'base64_post_string',
        'tp+ZLmKm1/E83dIzUpx5ljcttP4=',
        'your_private_key',
      ),
    ).toBe(true);
  });

  it('rejects a tampered payload or a wrong key', () => {
    const data = encodeLiqpayData({ order_id: 'A-1', status: 'success', amount: 89 });
    const signature = liqpaySignature(data, 'secret');
    expect(verifyLiqpaySignature(data, signature, 'other-secret')).toBe(false);
    const tampered = encodeLiqpayData({ order_id: 'A-1', status: 'success', amount: 1 });
    expect(verifyLiqpaySignature(tampered, signature, 'secret')).toBe(false);
    expect(verifyLiqpaySignature(data, '', 'secret')).toBe(false);
  });

  it('round-trips data and refuses malformed payloads', () => {
    const data = encodeLiqpayData({ description: 'СмачноGo: Сюрприз-бокс', amount: 89 });
    expect(decodeLiqpayData(data)).toEqual({ description: 'СмачноGo: Сюрприз-бокс', amount: 89 });
    expect(decodeLiqpayData('not base64 json')).toBeNull();
    expect(decodeLiqpayData(Buffer.from('[1,2]').toString('base64'))).toBeNull();
  });
});

describe('LiqPay statuses', () => {
  it('maps provider statuses to payment states', () => {
    expect(liqpayState('success', false)).toBe('success');
    expect(liqpayState('sandbox', true)).toBe('success');
    expect(liqpayState('sandbox', false)).toBe('pending');
    expect(liqpayState('failure', false)).toBe('failure');
    expect(liqpayState('error', false)).toBe('failure');
    expect(liqpayState('reversed', false)).toBe('reversed');
    expect(liqpayState('3ds_verify', false)).toBe('pending');
    expect(liqpayState(undefined, false)).toBe('pending');
  });

  it('reads payment fields from a callback', () => {
    const status = liqpayStatusFromPayload(
      { status: 'success', payment_id: 1234567, paytype: 'card', amount: 178, currency: 'UAH' },
      false,
    );
    expect(status).toMatchObject({
      state: 'success',
      providerPaymentId: '1234567',
      method: 'card',
      amount: '178',
      currency: 'UAH',
    });
  });

  it('formats expired_date in UTC', () => {
    expect(liqpayExpiredDate(new Date('2026-10-18T17:05:09.123Z'))).toBe('2026-10-18 17:05:09');
  });
});

describe('LiqPay checkout', () => {
  it('builds signed checkout data with callback and return URLs', async () => {
    const gateway = new LiqpayGateway('i000', 'priv', true, 'https://api.example.com');
    const checkout = await gateway.createCheckout({
      providerOrderId: '01JABCDEF-1',
      amount: new Decimal('178.5'),
      description: 'СмачноGo: Сюрприз-бокс',
      expiresAt: new Date('2026-10-18T17:05:00Z'),
    });
    expect(checkout.provider).toBe('liqpay');
    expect(checkout.signature).toBe(liqpaySignature(checkout.data!, 'priv'));
    expect(checkout.checkoutUrl).toContain('https://www.liqpay.ua/api/3/checkout?data=');
    expect(decodeLiqpayData(checkout.data!)).toEqual({
      version: 3,
      public_key: 'i000',
      action: 'pay',
      amount: 178.5,
      currency: 'UAH',
      description: 'СмачноGo: Сюрприз-бокс',
      order_id: '01JABCDEF-1',
      language: 'uk',
      result_url: 'https://api.example.com/api/v1/payments/liqpay/return?orderId=01JABCDEF-1',
      server_url: 'https://api.example.com/api/v1/payments/liqpay/callback',
      expired_date: '2026-10-18 17:05:00',
      sandbox: 1,
    });
  });
});

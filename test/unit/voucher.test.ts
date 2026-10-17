import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, VOUCHER_ALPHABET, voucherCode } from '../../src/lib/crypto.js';
import { buildVoucherToken, parseVoucherToken } from '../../src/modules/orders/voucher.js';

describe('voucher', () => {
  const validUntil = new Date('2026-10-16T18:15:00Z');

  it('round-trips the signed QR token', () => {
    const token = buildVoucherToken('01JABCDEFGHJKMNPQRSTVWXYZ0', 12n, validUntil);
    expect(parseVoucherToken(token)).toEqual({
      publicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      venueId: 12n,
      exp: validUntil,
    });
  });

  it('is deterministic so it can be shown again', () => {
    expect(buildVoucherToken('A'.repeat(26), 1n, validUntil)).toBe(
      buildVoucherToken('A'.repeat(26), 1n, validUntil),
    );
  });

  it('rejects a token with a changed venue', () => {
    const token = buildVoucherToken('01JABCDEFGHJKMNPQRSTVWXYZ0', 12n, validUntil);
    const [, signature] = token.split('.');
    const forged = `${Buffer.from(`01JABCDEFGHJKMNPQRSTVWXYZ0.13.${validUntil.getTime() / 1000}`).toString('base64url')}.${signature}`;
    expect(parseVoucherToken(forged)).toBeNull();
    expect(parseVoucherToken('garbage')).toBeNull();
  });

  it('generates 6-character codes without look-alike characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = voucherCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(VOUCHER_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it('encrypts IBANs with AES-256-GCM', () => {
    const iban = 'UA213223130000026007233566001';
    const encrypted = encrypt(iban);
    expect(encrypted).not.toContain(iban);
    expect(encrypt(iban)).not.toBe(encrypted);
    expect(decrypt(encrypted)).toBe(iban);
  });
});

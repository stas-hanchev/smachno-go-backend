import { describe, expect, it } from 'vitest';
import { deliveryUrl, publicIdFromUrl } from '../../src/lib/cloudinary.js';
import { detectImageType } from '../../src/lib/images.js';

const pad = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by signature', () => {
    expect(detectImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(detectImageType(webp)).toBe('webp');
  });

  it('rejects other files even with an image extension', () => {
    expect(
      detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
    expect(detectImageType(pad([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('Cloudinary URLs', () => {
  it('builds delivery URLs and parses the public id back', () => {
    const url = deliveryUrl('demo', 'smachnogo/venues/1/logo-01abc');
    expect(url).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/smachnogo/venues/1/logo-01abc',
    );
    expect(publicIdFromUrl(url, 'demo')).toBe('smachnogo/venues/1/logo-01abc');
  });

  it('handles versions, extensions and foreign URLs', () => {
    expect(
      publicIdFromUrl(
        'https://res.cloudinary.com/demo/image/upload/v1712/smachnogo/a/b.jpg',
        'demo',
      ),
    ).toBe('smachnogo/a/b');
    expect(publicIdFromUrl('https://example.com/a.jpg', 'demo')).toBeNull();
    expect(publicIdFromUrl('https://res.cloudinary.com/other/image/upload/x', 'demo')).toBeNull();
  });
});

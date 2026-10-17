import { describe, expect, it } from 'vitest';
import { boundingBox, distanceMeters } from '../../src/lib/geo.js';

const kyiv = { lat: 50.4501, lng: 30.5234 };
const kharkiv = { lat: 49.9935, lng: 36.2304 };
const ecofood = { lat: 50.4475, lng: 30.5222 };
const khlib = { lat: 50.4342, lng: 30.5169 };

describe('geo', () => {
  it('measures the Kyiv - Kharkiv straight-line distance (~410 km)', () => {
    const km = distanceMeters(kyiv, kharkiv) / 1000;
    expect(km).toBeGreaterThan(405);
    expect(km).toBeLessThan(415);
  });

  it('measures short distances inside Kyiv', () => {
    const m = distanceMeters(ecofood, khlib);
    expect(m).toBeGreaterThan(1400);
    expect(m).toBeLessThan(1600);
    expect(distanceMeters(ecofood, ecofood)).toBe(0);
  });

  it('builds a bounding box that contains the whole radius', () => {
    const radius = 5000;
    const box = boundingBox(kyiv, radius);
    for (const bearing of [0, 90, 180, 270]) {
      const rad = (bearing * Math.PI) / 180;
      const point = {
        lat: kyiv.lat + (radius / 111_195) * Math.cos(rad) * 0.999,
        lng:
          kyiv.lng +
          ((radius / 111_195) * Math.sin(rad) * 0.999) / Math.cos((kyiv.lat * Math.PI) / 180),
      };
      expect(point.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(point.lat).toBeLessThanOrEqual(box.maxLat);
      expect(point.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(point.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });
});

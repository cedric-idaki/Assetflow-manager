import { describe, it, expect } from 'vitest';
import { logoFileProblem, targetSize, opaqueBounds, hasTransparency, LOGO_MAX_EDGE } from './logoImage';

const file = (type, size = 1000) => ({ type, size });

describe('logoFileProblem', () => {
  it('accepts the four formats a logo arrives in', () => {
    ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].forEach((t) => {
      expect(logoFileProblem(file(t))).toBe('');
    });
  });

  it('refuses anything else, and says what to do', () => {
    expect(logoFileProblem(file('application/pdf'))).toMatch(/PNG, JPEG, WEBP or SVG/);
    expect(logoFileProblem(file('image/png', 6 * 1024 * 1024))).toMatch(/larger than 5 MB/);
    expect(logoFileProblem(file('image/png', 0))).toMatch(/empty/);
    expect(logoFileProblem(null)).toMatch(/Choose/);
  });
});

describe('targetSize', () => {
  it('caps the long edge and keeps the aspect ratio', () => {
    expect(targetSize(2048, 1024)).toEqual({ width: LOGO_MAX_EDGE, height: 256 });
    expect(targetSize(300, 1200)).toEqual({ width: 128, height: LOGO_MAX_EDGE });
  });

  it('never scales a bitmap up', () => {
    expect(targetSize(120, 60)).toEqual({ width: 120, height: 60 });
  });

  it('draws an SVG at full size, and one with no size into the full square', () => {
    expect(targetSize(100, 50, { upscale: true })).toEqual({ width: 512, height: 256 });
    expect(targetSize(0, 0, { upscale: true })).toEqual({ width: 512, height: 512 });
  });
});

describe('opaqueBounds / hasTransparency', () => {
  // A 4×3 image, transparent except a 2×1 mark at (1,1)-(2,1).
  const w = 4;
  const h = 3;
  const data = new Uint8ClampedArray(w * h * 4);
  [[1, 1], [2, 1]].forEach(([x, y]) => { data[(y * w + x) * 4 + 3] = 255; });

  it('finds the mark inside its transparent margins', () => {
    expect(opaqueBounds(data, w, h)).toEqual({ x: 1, y: 1, width: 2, height: 1 });
  });

  it('ignores the faint halo anti-aliasing leaves', () => {
    const halo = new Uint8ClampedArray(data);
    halo[(0 * w + 0) * 4 + 3] = 5;
    expect(opaqueBounds(halo, w, h)).toEqual({ x: 1, y: 1, width: 2, height: 1 });
  });

  it('reports an entirely transparent image as having no mark', () => {
    expect(opaqueBounds(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull();
  });

  it('tells a transparent image from an opaque one', () => {
    expect(hasTransparency(data)).toBe(true);
    expect(hasTransparency(new Uint8ClampedArray(16).fill(255))).toBe(false);
  });
});

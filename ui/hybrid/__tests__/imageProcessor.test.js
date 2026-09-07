import { describe, it, expect } from 'vitest';
import {
  rgbToHsv,
  hsvDist,
  buildLut,
  extractMagneticGrid,
  renderGridToCanvas,
  computeImageGradientField,
  computeImageContourSegments,
} from '../imageProcessor.js';

describe('imageProcessor', () => {
  describe('rgbToHsv', () => {
    it('kırmızı → HSV', () => {
      const hsv = rgbToHsv(255, 0, 0);
      expect(hsv.h).toBeCloseTo(0, 0);
      expect(hsv.s).toBeCloseTo(1, 1);
      expect(hsv.v).toBeCloseTo(1, 1);
    });

    it('mavi → HSV', () => {
      const hsv = rgbToHsv(0, 0, 255);
      expect(hsv.h).toBeCloseTo(240, 0);
      expect(hsv.s).toBeCloseTo(1, 1);
      expect(hsv.v).toBeCloseTo(1, 1);
    });

    it('yeşil → HSV', () => {
      const hsv = rgbToHsv(0, 128, 0);
      expect(hsv.h).toBeCloseTo(120, 0);
      expect(hsv.s).toBeCloseTo(1, 1);
      expect(hsv.v).toBeCloseTo(0.5, 1);
    });

    it('siyah → HSV', () => {
      expect(rgbToHsv(0, 0, 0).v).toBe(0);
    });

    it('beyaz → HSV', () => {
      const hsv = rgbToHsv(255, 255, 255);
      expect(hsv.s).toBe(0);
      expect(hsv.v).toBeCloseTo(1, 1);
    });
  });

  describe('hsvDist', () => {
    it('aynı renk → mesafe 0', () => {
      const a = { h: 120, s: 0.5, v: 0.8 };
      expect(hsvDist(a, a)).toBe(0);
    });

    it('farklı renkler → pozitif mesafe', () => {
      expect(hsvDist({ h: 0, s: 1, v: 1 }, { h: 240, s: 1, v: 1 })).toBeGreaterThan(0);
    });

    it('hue wrap-around → kısa mesafe', () => {
      expect(hsvDist({ h: 5, s: 0.5, v: 0.8 }, { h: 355, s: 0.5, v: 0.8 })).toBeLessThan(0.1);
    });
  });

  describe('buildLut', () => {
    it('LUT oluşturur', () => {
      const width = 20, height = 100;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;
        data[i + 3] = 255;
      }
      const lut = buildLut({ data, width, height }, 20);
      expect(lut).toHaveLength(height);
      expect(lut[0].h).toBeCloseTo(0, 0);
    });
  });

  describe('image gradient and contour processing', () => {
    const grid = [
      { gx: 0, gy: 0, nT: 0 }, { gx: 1, gy: 0, nT: 10 }, { gx: 2, gy: 0, nT: 20 },
      { gx: 0, gy: 1, nT: 0 }, { gx: 1, gy: 1, nT: 10 }, { gx: 2, gy: 1, nT: 20 },
      { gx: 0, gy: 2, nT: 0 }, { gx: 1, gy: 2, nT: 10 }, { gx: 2, gy: 2, nT: 20 },
    ];

    it('hesaplanan gradient yönü ve büyüklüğü doğru', () => {
      const result = computeImageGradientField(grid, 3);
      expect(result.gradientX[4]).toBeCloseTo(10);
      expect(result.gradientY[4]).toBeCloseTo(0);
      expect(result.magnitude[4]).toBeCloseTo(10);
      expect(result.maxMagnitude).toBeCloseTo(10);
    });

    it('iso-nT konturları eksik hücreler arasında çizgi üretmez', () => {
      const result = computeImageContourSegments(grid, 3, 2);
      expect(result.levels).toHaveLength(2);
      expect(result.segments.length).toBeGreaterThan(0);
      expect(computeImageContourSegments(grid.slice(0, 4), 3, 2).segments).toHaveLength(0);
    });
  });

  describe('render and extraction APIs', () => {
    it('renderGridToCanvas dışa aktarılan fonksiyondur', () => {
      expect(typeof renderGridToCanvas).toBe('function');
    });

    it('extractMagneticGrid dışa aktarılan fonksiyondur', () => {
      expect(typeof extractMagneticGrid).toBe('function');
    });
  });
});

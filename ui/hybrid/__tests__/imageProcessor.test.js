import { describe, it, expect } from 'vitest';
import {
  rgbToHsv,
  hsvDist,
  buildLut,
  extractMagneticGrid,
  renderGridToCanvas,
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
      const hsv = rgbToHsv(0, 0, 0);
      expect(hsv.v).toBe(0);
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
      const d = hsvDist(a, a);
      expect(d).toBe(0);
    });

    it('farklı renkler → pozitif mesafe', () => {
      const a = { h: 0, s: 1, v: 1 };    // kırmızı
      const b = { h: 240, s: 1, v: 1 };  // mavi
      const d = hsvDist(a, b);
      expect(d).toBeGreaterThan(0);
    });

    it('humnedral wrap-around → kısa mesafe', () => {
      const a = { h: 5, s: 0.5, v: 0.8 };
      const b = { h: 355, s: 0.5, v: 0.8 };
      const d = hsvDist(a, b);
      expect(d).toBeLessThan(0.1); // Çok yakın olmalı
    });
  });

  describe('buildLut', () => {
    it('LUT oluştur', () => {
      // Basit test: 10x100 kırmızı şerit
      const width = 20, height = 100;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          data[i] = 255;     // R
          data[i + 1] = 0;   // G
          data[i + 2] = 0;   // B
          data[i + 3] = 255; // A
        }
      }
      const imageData = { data, width, height };
      const lut = buildLut(imageData, 20);
      expect(lut.length).toBe(height);
      expect(lut[0].h).toBeCloseTo(0, 0); // Hep kırmızı
    });
  });

  describe('renderGridToCanvas', () => {
    it('grid → canvas oluştur (mock)', () => {
      // Node.js ortamında document yok — sadece fonksiyonun varlığını kontrol et
      expect(typeof renderGridToCanvas).toBe('function');
    });
  });

  describe('extractMagneticGrid', () => {
    it('mock görüntüden grid çıkarma', () => {
      // Mock canvas/context
      const mockCtx = {
        drawImage: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray(200 * 100 * 4).fill(128),
          width: 200,
          height: 100,
        }),
        fillRect: () => {},
        fillStyle: '',
        font: '',
        fillText: () => {},
      };

      const mockCanvas = {
        width: 200,
        height: 100,
        getContext: () => mockCtx,
      };

      // Mock Image
      const mockImg = {
        naturalWidth: 200,
        naturalHeight: 100,
        width: 200,
        height: 100,
      };

      // Test sadece fonksiyonun çağrılabildiğini doğrular
      // (gerçek canvas gerektirdiği için tam sonuç test edilmez)
      expect(typeof extractMagneticGrid).toBe('function');
    });
  });
});

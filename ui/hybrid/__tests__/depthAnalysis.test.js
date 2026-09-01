import { describe, it, expect } from 'vitest';
import {
  analyzeDepth,
  extractDepthProfile,
  renderDepthProfile,
  formatDepthStats,
  SOIL_PROFILES,
} from '../depthAnalysis.js';

describe('depthAnalysis', () => {
  // Mock fusion grid
  const fusionGrid = [
    { gx: 0, gy: 0, x: 0.1, y: 0.1, worldX: -10, worldY: -10, magnetic: 400, confidence: 0.8, sources: ['csv'] },
    { gx: 1, gy: 0, x: 0.3, y: 0.1, worldX: -5, worldY: -10, magnetic: 300, confidence: 0.7, sources: ['csv'] },
    { gx: 2, gy: 0, x: 0.5, y: 0.1, worldX: 0, worldY: -10, magnetic: 100, confidence: 0.6, sources: ['image'] },
    { gx: 3, gy: 0, x: 0.7, y: 0.1, worldX: 5, worldY: -10, magnetic: 50, confidence: 0.5, sources: ['image'] },
    { gx: 0, gy: 1, x: 0.1, y: 0.3, worldX: -10, worldY: -5, magnetic: 350, confidence: 0.75, sources: ['csv'] },
    { gx: 1, gy: 1, x: 0.3, y: 0.3, worldX: -5, worldY: -5, magnetic: 250, confidence: 0.7, sources: ['csv'] },
    { gx: 2, gy: 1, x: 0.5, y: 0.3, worldX: 0, worldY: -5, magnetic: 80, confidence: 0.6, sources: ['image'] },
    { gx: 3, gy: 1, x: 0.7, y: 0.3, worldX: 5, worldY: -5, magnetic: 30, confidence: 0.4, sources: ['image'] },
    { gx: 0, gy: 2, x: 0.1, y: 0.5, worldX: -10, worldY: 0, magnetic: 200, confidence: 0.65, sources: ['csv'] },
    { gx: 1, gy: 2, x: 0.3, y: 0.5, worldX: -5, worldY: 0, magnetic: 150, confidence: 0.6, sources: ['csv'] },
    { gx: 2, gy: 2, x: 0.5, y: 0.5, worldX: 0, worldY: 0, magnetic: 60, confidence: 0.55, sources: ['image'] },
    { gx: 3, gy: 2, x: 0.7, y: 0.5, worldX: 5, worldY: 0, magnetic: 20, confidence: 0.3, sources: ['image'] },
  ];

  describe('SOIL_PROFILES', () => {
    it('toprak profilleri tanımlı', () => {
      expect(SOIL_PROFILES.loam).toBeDefined();
      expect(SOIL_PROFILES.loam.factor).toBe(1.0);
      expect(SOIL_PROFILES.sand.factor).toBe(1.1);
      expect(SOIL_PROFILES.clay.factor).toBe(0.85);
    });
  });

  describe('analyzeDepth', () => {
    it('boş grid ile analiz', () => {
      const result = analyzeDepth({ fusionGrid: [], gridRes: 4 });
      expect(result.depthGrid.length).toBe(0);
      expect(result.stats.totalCells).toBe(0);
    });

    it('normal grid ile analiz', () => {
      const result = analyzeDepth({
        fusionGrid,
        gridRes: 4,
        ntRange: 500,
        soilType: 'loam',
      });

      expect(result.depthGrid.length).toBeGreaterThan(0);
      expect(result.stats.totalCells).toBeGreaterThan(0);
      expect(result.stats.avgDepth).toBeGreaterThan(0);
      expect(result.stats.depthMin).toBeGreaterThan(0);
      expect(result.stats.depthMax).toBeGreaterThan(result.stats.depthMin);
    });

    it('toprak profili etkisi', () => {
      const loamResult = analyzeDepth({
        fusionGrid,
        gridRes: 4,
        soilType: 'loam',
      });

      const clayResult = analyzeDepth({
        fusionGrid,
        gridRes: 4,
        soilType: 'clay',
      });

      // Kil toprağı (factor 0.85) daha sığ derinlik vermeli
      expect(clayResult.stats.avgDepth).toBeLessThan(loamResult.stats.avgDepth * 1.2);
    });

    it('güçlü sinyal → sığ derinlik', () => {
      const strongGrid = [
        { gx: 0, gy: 0, x: 0.5, y: 0.5, worldX: 0, worldY: 0, magnetic: 500, confidence: 0.9, sources: ['csv'] },
      ];

      const result = analyzeDepth({
        fusionGrid: strongGrid,
        gridRes: 2,
        ntRange: 500,
      });

      expect(result.depthGrid[0].depth).toBeLessThan(5); // Sığ
    });

    it('zayıf sinyal → derin', () => {
      const weakGrid = [
        { gx: 0, gy: 0, x: 0.5, y: 0.5, worldX: 0, worldY: 0, magnetic: 20, confidence: 0.5, sources: ['image'] },
      ];

      const result = analyzeDepth({
        fusionGrid: weakGrid,
        gridRes: 2,
        ntRange: 500,
      });

      expect(result.depthGrid[0].depth).toBeGreaterThan(3); // Derin
    });

    it('hücre yapısı doğru', () => {
      const result = analyzeDepth({
        fusionGrid,
        gridRes: 4,
      });

      for (const cell of result.depthGrid) {
        expect(cell.depth).toBeGreaterThan(0);
        expect(cell.depth).toBeLessThanOrEqual(30);
        expect(cell.confidence).toBeGreaterThanOrEqual(0);
        expect(cell.confidence).toBeLessThanOrEqual(1);
        expect(['shallow', 'mid', 'deep']).toContain(cell.band);
        expect(typeof cell.gradient).toBe('number');
      }
    });

    it('derinlik bantları', () => {
      const result = analyzeDepth({
        fusionGrid,
        gridRes: 4,
      });

      const totalBands = result.stats.shallowCount + result.stats.midCount + result.stats.deepCount;
      expect(totalBands).toBe(result.stats.totalCells);
    });
  });

  describe('extractDepthProfile', () => {
    it('yatay profil çıkarma', () => {
      const result = analyzeDepth({ fusionGrid, gridRes: 4 });
      const profile = extractDepthProfile(result.depthGrid, {
        x1: 0, y1: 0.2,
        x2: 1, y2: 0.2,
      }, 20);

      expect(profile.length).toBe(20);
      for (const p of profile) {
        expect(p.depth).toBeGreaterThanOrEqual(0);
        expect(p.t).toBeGreaterThanOrEqual(0);
        expect(p.t).toBeLessThanOrEqual(1);
      }
    });

    it('dikey profil çıkarma', () => {
      const result = analyzeDepth({ fusionGrid, gridRes: 4 });
      const profile = extractDepthProfile(result.depthGrid, {
        x1: 0.3, y1: 0,
        x2: 0.3, y2: 1,
      }, 15);

      expect(profile.length).toBe(15);
    });

    it('boş grid ile profil', () => {
      const profile = extractDepthProfile([], { x1: 0, y1: 0, x2: 1, y2: 1 }, 10);
      expect(profile.length).toBe(0);
    });
  });

  describe('formatDepthStats', () => {
    it('HTML formatı', () => {
      const result = analyzeDepth({ fusionGrid, gridRes: 4 });
      const html = formatDepthStats(result.stats);

      expect(html).toContain('depth-stats');
      expect(html).toContain('Derinlik Aralığı');
      expect(html).toContain('Ortalama');
      expect(html).toContain('Toprak');
      expect(html).toContain('Güven');
    });

    it('bant yüzdesi', () => {
      const result = analyzeDepth({ fusionGrid, gridRes: 4 });
      const html = formatDepthStats(result.stats);

      expect(html).toContain('Sığ');
      expect(html).toContain('Orta');
      expect(html).toContain('Derin');
    });
  });

  describe('Edge cases', () => {
    it('tek hücreli grid', () => {
      const singleCell = [
        { gx: 0, gy: 0, x: 0.5, y: 0.5, worldX: 0, worldY: 0, magnetic: 200, confidence: 0.7, sources: ['csv'] },
      ];

      const result = analyzeDepth({ fusionGrid: singleCell, gridRes: 1 });
      expect(result.depthGrid.length).toBe(1);
      expect(result.depthGrid[0].depth).toBeGreaterThan(0);
    });

    it('tüm negatif manyetik', () => {
      const negGrid = fusionGrid.map(c => ({ ...c, magnetic: -c.magnetic }));
      const result = analyzeDepth({ fusionGrid: negGrid, gridRes: 4 });
      expect(result.depthGrid.length).toBeGreaterThan(0);
    });

    it('sıfır manyetik', () => {
      const zeroGrid = fusionGrid.map(c => ({ ...c, magnetic: 0 }));
      const result = analyzeDepth({ fusionGrid: zeroGrid, gridRes: 4 });
      expect(result.depthGrid.length).toBeGreaterThan(0);
    });
  });
});

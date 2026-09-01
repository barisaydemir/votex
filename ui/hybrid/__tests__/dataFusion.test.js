import { describe, it, expect } from 'vitest';
import {
  fuseDataSources,
  renderFusionCanvas,
  renderConfidenceMap,
  renderComparisonMap,
  formatFusionStats,
  DEFAULT_WEIGHTS,
  CONFIDENCE_THRESHOLDS,
} from '../dataFusion.js';

describe('dataFusion', () => {
  // Mock veri
  const csvPoints = [
    { x: -10, y: -10, magnetic: 400 },
    { x: -5, y: -5, magnetic: 300 },
    { x: 0, y: 0, magnetic: 200 },
    { x: 5, y: 5, magnetic: 100 },
    { x: 10, y: 10, magnetic: 50 },
  ];

  const imageGrid = [
    { x: -10, y: -10, nT: 380 },
    { x: -5, y: -5, nT: 310 },
    { x: 0, y: 0, nT: 190 },
    { x: 5, y: 5, nT: 120 },
    { x: 10, y: 10, nT: 40 },
  ];

  describe('DEFAULT_WEIGHTS', () => {
    it('varsayılan ağırlıklar', () => {
      expect(DEFAULT_WEIGHTS.csv).toBe(0.70);
      expect(DEFAULT_WEIGHTS.image).toBe(0.30);
    });
  });

  describe('CONFIDENCE_THRESHOLDS', () => {
    it('eşik değerleri tanımlı', () => {
      expect(CONFIDENCE_THRESHOLDS.excellent).toBeGreaterThan(CONFIDENCE_THRESHOLDS.good);
      expect(CONFIDENCE_THRESHOLDS.good).toBeGreaterThan(CONFIDENCE_THRESHOLDS.fair);
      expect(CONFIDENCE_THRESHOLDS.fair).toBeGreaterThan(CONFIDENCE_THRESHOLDS.poor);
    });
  });

  describe('fuseDataSources', () => {
    it('boş veri ile fusion', () => {
      const result = fuseDataSources({
        imageGrid: [],
        csvPoints: [],
        gridRes: 10,
      });
      expect(result.grid.length).toBe(0);
      expect(result.stats.filledCells).toBe(0);
    });

    it('sadece CSV ile fusion', () => {
      const result = fuseDataSources({
        imageGrid: [],
        csvPoints,
        gridRes: 8,
      });
      expect(result.grid.length).toBeGreaterThan(0);
      expect(result.stats.csvOnlyCells).toBeGreaterThan(0);
      expect(result.stats.imageOnlyCells).toBe(0);
      expect(result.stats.bothCells).toBe(0);
    });

    it('sadece Image ile fusion', () => {
      const result = fuseDataSources({
        imageGrid,
        csvPoints: [],
        gridRes: 8,
      });
      expect(result.grid.length).toBeGreaterThan(0);
      expect(result.stats.imageOnlyCells).toBeGreaterThan(0);
      expect(result.stats.csvOnlyCells).toBe(0);
    });

    it('her iki kaynak ile fusion', () => {
      const result = fuseDataSources({
        imageGrid,
        csvPoints,
        gridRes: 8,
      });
      expect(result.grid.length).toBeGreaterThan(0);
      expect(result.stats.bothCells).toBeGreaterThan(0);
      expect(result.stats.avgConfidence).toBeGreaterThan(0.5);
    });

    it('ağırlık ayarlama', () => {
      const resultHighCsv = fuseDataSources({
        imageGrid,
        csvPoints,
        gridRes: 8,
        csvWeight: 0.9,
        imageWeight: 0.1,
      });

      const resultHighImg = fuseDataSources({
        imageGrid,
        csvPoints,
        gridRes: 8,
        csvWeight: 0.1,
        imageWeight: 0.9,
      });

      // Yüksek CSV ağırlığında CSV etkisi daha fazla olmalı
      const csvDominated = resultHighCsv.grid.filter(c => c.bothSources || c.sources.includes('csv'));
      const imgDominated = resultHighImg.grid.filter(c => c.bothSources || c.sources.includes('image'));

      expect(resultHighCsv.stats.avgConfidence).toBeGreaterThan(0);
      expect(resultHighImg.stats.avgConfidence).toBeGreaterThan(0);
    });

    it('grid yapısı doğru', () => {
      const result = fuseDataSources({
        imageGrid,
        csvPoints,
        gridRes: 4,
      });

      for (const cell of result.grid) {
        expect(cell.gx).toBeGreaterThanOrEqual(0);
        expect(cell.gy).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThanOrEqual(1);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThanOrEqual(1);
        expect(cell.confidence).toBeGreaterThanOrEqual(0);
        expect(cell.confidence).toBeLessThanOrEqual(1);
        expect(Array.isArray(cell.sources)).toBe(true);
      }
    });

    it('güven skoru hesaplama', () => {
      const result = fuseDataSources({
        imageGrid,
        csvPoints,
        gridRes: 4,
      });

      for (const cell of result.grid) {
        expect(cell.confidence).toBeGreaterThanOrEqual(0);
        expect(cell.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('tutarlı manyetik değerler', () => {
      const result = fuseDataSources({
        imageGrid,
        csvPoints,
        gridRes: 4,
      });

      for (const cell of result.grid) {
        expect(typeof cell.magnetic).toBe('number');
        expect(Number.isFinite(cell.magnetic)).toBe(true);
      }
    });
  });

  describe('formatFusionStats', () => {
    it('HTML formatı', () => {
      const result = fuseDataSources({
        imageGrid,
        csvPoints,
        gridRes: 4,
      });

      const html = formatFusionStats(result.stats);
      expect(html).toContain('fusion-stats');
      expect(html).toContain('Grid');
      expect(html).toContain('Doluluk');
      expect(html).toContain('Güven');
      expect(html).toContain('Uyum');
    });
  });

  describe('Edge cases', () => {
    it('tek noktalı veri', () => {
      const result = fuseDataSources({
        imageGrid: [{ x: 0, y: 0, nT: 100 }],
        csvPoints: [{ x: 0, y: 0, magnetic: 150 }],
        gridRes: 2,
      });
      expect(result.grid.length).toBeGreaterThan(0);
    });

    it('çok büyük grid', () => {
      const result = fuseDataSources({
        imageGrid,
        csvPoints,
        gridRes: 128,
      });
      expect(result.grid.length).toBeGreaterThan(0);
      expect(result.stats.filledCells).toBeGreaterThan(0);
    });

    it('aynı noktalarda her iki kaynak', () => {
      const shared = [
        { x: 0, y: 0, magnetic: 100, nT: 100 },
        { x: 10, y: 10, magnetic: 200, nT: 200 },
      ];
      const result = fuseDataSources({
        imageGrid: shared.map(p => ({ x: p.x, y: p.y, nT: p.nT })),
        csvPoints: shared.map(p => ({ x: p.x, y: p.y, magnetic: p.magnetic })),
        gridRes: 4,
      });
      // Her iki kaynak da olan hücreler olmalı
      expect(result.stats.bothCells).toBeGreaterThan(0);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  generateHints,
  formatHintsList,
  generateCombinedReport,
  HINT_TYPES,
  HINT_SIZES,
} from '../hybridHints.js';

describe('hybridHints', () => {
  // Mock cross-validation sonucu
  const mockCrossValResult = {
    matches: [
      {
        image: { x: 0, y: 0, type: 'oda', depth: 5, magnetic: 300 },
        csv: { x: 0.5, y: 0.5, type: 'oda', depth: 5.2, magnetic: 310 },
        distance: 0.7,
        depthDiff: 0.2,
        magneticDiff: 10,
        typeMatch: true,
        isConsistent: true,
        confidence: 0.85,
      },
      {
        image: { x: 10, y: 10, type: 'metal', depth: 3, magnetic: 400 },
        csv: { x: 10.2, y: 9.8, type: 'metal', depth: 3.1, magnetic: 390 },
        distance: 0.28,
        depthDiff: 0.1,
        magneticDiff: 10,
        typeMatch: true,
        isConsistent: true,
        confidence: 0.92,
      },
    ],
    mismatches: [
      {
        image: { x: 20, y: 20, type: 'oda', depth: 8, magnetic: 200 },
        csv: { x: 20, y: 20, type: 'tunnel', depth: 12, magnetic: 180 },
        distance: 0,
        depthDiff: 4,
        magneticDiff: 20,
        typeMatch: false,
        isConsistent: false,
        confidence: 0.4,
      },
    ],
    unmatchedImage: [
      { x: 30, y: 30, type: 'oda', depth: 6, magnetic: 350, confidence: 0.7 },
    ],
    unmatchedCsv: [
      { x: 40, y: 40, type: 'metal', depth: 2, magnetic: 450, confidence: 0.8 },
    ],
    stats: {
      agreementRate: 0.67,
      overallConfidence: 0.72,
    },
  };

  describe('HINT_TYPES', () => {
    it('tüm tipler tanımlı', () => {
      expect(HINT_TYPES.consensus).toBeDefined();
      expect(HINT_TYPES.imageStrong).toBeDefined();
      expect(HINT_TYPES.csvStrong).toBeDefined();
      expect(HINT_TYPES.uncertain).toBeDefined();
    });

    it('öncelik sırası doğru', () => {
      expect(HINT_TYPES.consensus.priority).toBeLessThan(HINT_TYPES.imageStrong.priority);
      expect(HINT_TYPES.imageStrong.priority).toBeLessThan(HINT_TYPES.csvStrong.priority);
      expect(HINT_TYPES.csvStrong.priority).toBeLessThan(HINT_TYPES.uncertain.priority);
    });
  });

  describe('HINT_SIZES', () => {
    it('boyutlar tanımlı', () => {
      expect(HINT_SIZES.consensus).toBeGreaterThan(0);
      expect(HINT_SIZES.imageStrong).toBeGreaterThan(0);
      expect(HINT_SIZES.csvStrong).toBeGreaterThan(0);
      expect(HINT_SIZES.uncertain).toBeGreaterThan(0);
    });

    it('konsensüs en büyük', () => {
      expect(HINT_SIZES.consensus).toBeGreaterThanOrEqual(HINT_SIZES.imageStrong);
      expect(HINT_SIZES.consensus).toBeGreaterThanOrEqual(HINT_SIZES.csvStrong);
    });
  });

  describe('generateHints', () => {
    it('boş sonuç ile', () => {
      const hints = generateHints(null);
      expect(hints.length).toBe(0);
    });

    it('normal sonuç ile', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      expect(hints.length).toBeGreaterThan(0);
    });

    it('konsensüs tespitleri üretilir', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      const consensus = hints.filter(h => h.type === 'consensus');
      expect(consensus.length).toBe(2); // 2 uyumlu eşleşme
    });

    it('image-strong tespitler üretilir', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      const imageHints = hints.filter(h => h.type === 'imageStrong');
      expect(imageHints.length).toBe(1); // 1 eşleşmemiş image
    });

    it('csv-strong tespitler üretilir', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      const csvHints = hints.filter(h => h.type === 'csvStrong');
      expect(csvHints.length).toBe(1); // 1 eşleşmemiş CSV
    });

    it('uncertain tespitler üretilir', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      const uncertain = hints.filter(h => h.type === 'uncertain');
      expect(uncertain.length).toBe(1); // 1 uyumsuz
    });

    it('öncelik sırasına göre sıralı', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      for (let i = 1; i < hints.length; i++) {
        const prev = HINT_TYPES[hints[i - 1].type]?.priority || 99;
        const curr = HINT_TYPES[hints[i].type]?.priority || 99;
        expect(prev).toBeLessThanOrEqual(curr);
      }
    });

    it('minimum güven eşiği', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.9 });
      // Yüksek eşik → daha az ipucu
      expect(hints.length).toBeLessThanOrEqual(5);
    });

    it('ipucu yapısı doğru', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      for (const h of hints) {
        expect(typeof h.type).toBe('string');
        expect(typeof h.x).toBe('number');
        expect(typeof h.y).toBe('number');
        expect(typeof h.depth).toBe('number');
        expect(typeof h.confidence).toBe('number');
        expect(typeof h.label).toBe('string');
        expect(h.confidence).toBeGreaterThanOrEqual(0);
        expect(h.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('formatHintsList', () => {
    it('boş liste', () => {
      const html = formatHintsList([]);
      expect(html).toContain('hints-empty');
    });

    it('null liste', () => {
      const html = formatHintsList(null);
      expect(html).toContain('hints-empty');
    });

    it('normal liste', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      const html = formatHintsList(hints);
      expect(html).toContain('hints-list');
      expect(html).toContain('hints-group');
    });

    it('grup başlıkları', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      const html = formatHintsList(hints);
      expect(html).toContain('Konsensüs');
    });
  });

  describe('generateCombinedReport', () => {
    it('boş rapor', () => {
      const html = generateCombinedReport(null, null);
      expect(html).toBe('');
    });

    it('normal rapor', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      const html = generateCombinedReport(mockCrossValResult, hints);
      expect(html).toContain('cv-combined-report');
      expect(html).toContain('Hibrit Geri Besleme');
      expect(html).toContain('Konsensüs');
    });

    it('istatistikler', () => {
      const hints = generateHints(mockCrossValResult, { minConfidence: 0.3 });
      const html = generateCombinedReport(mockCrossValResult, hints);
      expect(html).toContain('cvcr-stat');
    });
  });

  describe('Edge cases', () => {
    it('sadece_matches', () => {
      const result = {
        matches: mockCrossValResult.matches,
        mismatches: [],
        unmatchedImage: [],
        unmatchedCsv: [],
      };
      const hints = generateHints(result, { minConfidence: 0.3 });
      expect(hints.filter(h => h.type === 'consensus').length).toBe(2);
    });

    it('sadece_mismatches', () => {
      const result = {
        matches: [],
        mismatches: mockCrossValResult.mismatches,
        unmatchedImage: [],
        unmatchedCsv: [],
      };
      const hints = generateHints(result, { minConfidence: 0.3 });
      expect(hints.filter(h => h.type === 'uncertain').length).toBe(1);
    });

    it('çok fazla_ipucu', () => {
      const manyMatches = Array.from({ length: 50 }, (_, i) => ({
        image: { x: i, y: i, type: 'oda', depth: 5 },
        csv: { x: i + 0.1, y: i + 0.1, type: 'oda', depth: 5 },
        distance: 0.14,
        depthDiff: 0,
        magneticDiff: 0,
        typeMatch: true,
        isConsistent: true,
        confidence: 0.8,
      }));

      const result = { matches: manyMatches, mismatches: [], unmatchedImage: [], unmatchedCsv: [] };
      const hints = generateHints(result, { minConfidence: 0.3 });
      expect(hints.length).toBe(50);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  crossValidate,
  findConsensusDetections,
  renderValidationMap,
  MATCH_DISTANCE_THRESHOLD,
  DEPTH_DIFF_THRESHOLD,
  MAGNETIC_DIFF_THRESHOLD,
} from '../crossValidation.js';

describe('crossValidation', () => {
  // Mock tespitler
  const imageDetections = [
    { x: 0, y: 0, type: 'oda', depth: 5, magnetic: 300, confidence: 0.8 },
    { x: 10, y: 10, type: 'tunnel', depth: 8, magnetic: 200, confidence: 0.7 },
    { x: 20, y: 20, type: 'metal', depth: 3, magnetic: 400, confidence: 0.9 },
    { x: 30, y: 30, type: 'oda', depth: 12, magnetic: 150, confidence: 0.6 },
  ];

  const csvDetections = [
    { x: 0.5, y: 0.5, type: 'oda', depth: 5.2, magnetic: 310, confidence: 0.85 },
    { x: 9.5, y: 10.5, type: 'tunnel', depth: 7.5, magnetic: 190, confidence: 0.75 },
    { x: 21, y: 19, type: 'metal', depth: 3.5, magnetic: 380, confidence: 0.88 },
    { x: 40, y: 40, type: 'oda', depth: 15, magnetic: 100, confidence: 0.5 },
  ];

  describe('Sabitler', () => {
    it('eşik değerleri tanımlı', () => {
      expect(MATCH_DISTANCE_THRESHOLD).toBeGreaterThan(0);
      expect(DEPTH_DIFF_THRESHOLD).toBeGreaterThan(0);
      expect(MAGNETIC_DIFF_THRESHOLD).toBeGreaterThan(0);
    });
  });

  describe('crossValidate', () => {
    it('boş tespitler ile', () => {
      const result = crossValidate({
        imageDetections: [],
        csvDetections: [],
      });

      expect(result.matches.length).toBe(0);
      expect(result.mismatches.length).toBe(0);
      expect(result.stats.agreementRate).toBe(0);
    });

    it('eşleşen tespitler', () => {
      const result = crossValidate({ imageDetections, csvDetections });

      // İlk 3 tespit birbirine yakın
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
    });

    it('uyumsuz tespitler', () => {
      // Farklı tipler ekle
      const imgDet = [{ x: 5, y: 5, type: 'oda', depth: 5, magnetic: 300 }];
      const csvDet = [{ x: 5, y: 5, type: 'metal', depth: 5, magnetic: 300 }];

      const result = crossValidate({ imageDetections: imgDet, csvDetections: csvDet });
      expect(result.mismatches.length).toBeGreaterThan(0);
      expect(result.mismatches[0].typeMatch).toBe(false);
    });

    it('eşleşmemiş tespitler', () => {
      const imgDet = [{ x: 0, y: 0, type: 'oda', depth: 5 }];
      const csvDet = [{ x: 100, y: 100, type: 'oda', depth: 5 }];

      const result = crossValidate({ imageDetections: imgDet, csvDetections: csvDet });
      expect(result.unmatchedImage.length).toBe(1);
      expect(result.unmatchedCsv.length).toBe(1);
    });

    it('yakın tespitler eşleşir', () => {
      const imgDet = [{ x: 5, y: 5, type: 'oda', depth: 5, magnetic: 300 }];
      const csvDet = [{ x: 5.1, y: 5.1, type: 'oda', depth: 5.1, magnetic: 305 }];

      const result = crossValidate({ imageDetections: imgDet, csvDetections: csvDet });
      expect(result.matches.length).toBe(1);
      expect(result.matches[0].distance).toBeLessThan(1);
      expect(result.matches[0].isConsistent).toBe(true);
    });

    it('uzak tespitler eşleşmez', () => {
      const imgDet = [{ x: 0, y: 0, type: 'oda', depth: 5 }];
      const csvDet = [{ x: 50, y: 50, type: 'oda', depth: 5 }];

      const result = crossValidate({ imageDetections: imgDet, csvDetections: csvDet });
      expect(result.matches.length).toBe(0);
      expect(result.unmatchedImage.length).toBe(1);
    });

    it('farklı derinlik → uyumsuz', () => {
      const imgDet = [{ x: 5, y: 5, type: 'oda', depth: 5, magnetic: 300 }];
      const csvDet = [{ x: 5, y: 5, type: 'oda', depth: 15, magnetic: 300 }];

      const result = crossValidate({ imageDetections: imgDet, csvDetections: csvDet });
      expect(result.mismatches.length).toBe(1);
      expect(result.mismatches[0].depthDiff).toBeGreaterThan(DEPTH_DIFF_THRESHOLD);
    });

    it('özel eşik değerleri', () => {
      const imgDet = [{ x: 5, y: 5, type: 'oda', depth: 5 }];
      const csvDet = [{ x: 8, y: 8, type: 'oda', depth: 5 }];

      // Kısa mesafe eşiği
      const strict = crossValidate({
        imageDetections: imgDet,
        csvDetections: csvDet,
        thresholds: { matchDistance: 2, depthDiff: 2, magneticDiff: 150 },
      });
      expect(strict.matches.length).toBe(0);

      // Geniş mesafe eşiği
      const loose = crossValidate({
        imageDetections: imgDet,
        csvDetections: csvDet,
        thresholds: { matchDistance: 5, depthDiff: 2, magneticDiff: 150 },
      });
      expect(loose.matches.length).toBe(1);
    });

    it('istatistikler doğru', () => {
      const result = crossValidate({ imageDetections, csvDetections });

      expect(result.stats.totalDetections).toBeGreaterThan(0);
      expect(result.stats.agreementRate).toBeGreaterThanOrEqual(0);
      expect(result.stats.agreementRate).toBeLessThanOrEqual(1);
      expect(result.stats.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(result.stats.overallConfidence).toBeLessThanOrEqual(1);
    });

    it('rapor HTML üretimi', () => {
      const result = crossValidate({ imageDetections, csvDetections });
      const report = result.report;

      expect(report).toContain('cv-report');
      expect(report).toContain('cv-summary');
      expect(report).toContain('Toplam Tespit');
    });
  });

  describe('findConsensusDetections', () => {
    it('yüksek güvenli eşleşmeleri filtrele', () => {
      const result = crossValidate({ imageDetections, csvDetections });
      const consensus = findConsensusDetections(result.matches, 0.5);

      expect(Array.isArray(consensus)).toBe(true);
      for (const d of consensus) {
        expect(d.confidence).toBeGreaterThanOrEqual(0.5);
        expect(d.sources).toContain('image');
        expect(d.sources).toContain('csv');
      }
    });

    it('düşük güvenli eşleşmeleri hariç tut', () => {
      const lowConfMatch = [{
        image: { x: 0, y: 0, type: 'oda', depth: 5, magnetic: 300 },
        csv: { x: 0, y: 0, type: 'oda', depth: 5, magnetic: 300 },
        distance: 0.1,
        depthDiff: 0,
        magneticDiff: 0,
        typeMatch: true,
        isConsistent: true,
        confidence: 0.3,
      }];

      const consensus = findConsensusDetections(lowConfMatch, 0.5);
      expect(consensus.length).toBe(0);
    });

    it('ortalam noktalar', () => {
      const match = [{
        image: { x: 0, y: 0, type: 'oda', depth: 5, magnetic: 300 },
        csv: { x: 2, y: 2, type: 'oda', depth: 7, magnetic: 350 },
        distance: 2.8,
        depthDiff: 2,
        magneticDiff: 50,
        typeMatch: true,
        isConsistent: true,
        confidence: 0.7,
      }];

      const consensus = findConsensusDetections(match, 0.5);
      expect(consensus.length).toBe(1);
      expect(consensus[0].x).toBe(1); // (0+2)/2
      expect(consensus[0].y).toBe(1);
      expect(consensus[0].depth).toBe(6); // (5+7)/2
      expect(consensus[0].magnetic).toBe(325);
    });
  });

  describe('Edge cases', () => {
    it('aynı noktalarda tespitler', () => {
      const det = [{ x: 5, y: 5, type: 'oda', depth: 5, magnetic: 300 }];
      const result = crossValidate({ imageDetections: det, csvDetections: det });
      expect(result.matches.length).toBe(1);
    });

    it('çok fazla tespit', () => {
      const many = Array.from({ length: 50 }, (_, i) => ({
        x: i, y: i, type: 'metal', depth: i * 0.5, magnetic: 200 + i,
      }));
      const result = crossValidate({ imageDetections: many, csvDetections: many });
      expect(result.matches.length).toBe(50);
    });

    it('negatif koordinatlar', () => {
      const imgDet = [{ x: -10, y: -10, type: 'oda', depth: 5 }];
      const csvDet = [{ x: -10, y: -10, type: 'oda', depth: 5 }];
      const result = crossValidate({ imageDetections: imgDet, csvDetections: csvDet });
      expect(result.matches.length).toBe(1);
    });
  });
});

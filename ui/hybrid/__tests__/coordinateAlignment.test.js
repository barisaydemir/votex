import { describe, it, expect, beforeEach } from 'vitest';
import {
  CoordinateAligner,
  autoAlignFromData,
} from '../coordinateAlignment.js';

describe('coordinateAlignment', () => {
  let aligner;

  beforeEach(() => {
    aligner = new CoordinateAligner();
  });

  describe('Constructor', () => {
    it('başlangıç durumu', () => {
      expect(aligner.imageBounds).toBeNull();
      expect(aligner.csvBounds).toBeNull();
      expect(aligner.transform).toBeNull();
      expect(aligner.controlPoints).toEqual([]);
      expect(aligner.mode).toBeNull();
      expect(aligner.rmse).toBe(0);
    });
  });

  describe('autoAlign', () => {
    it('basit otomatik hizalama', () => {
      const imgBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
      const csvBounds = { xMin: -15, xMax: 15, yMin: -15, yMax: 15 };

      const result = aligner.autoAlign(imgBounds, csvBounds);

      expect(aligner.mode).toBe('auto');
      expect(result.scaleX).toBeCloseTo(30, 1);
      expect(result.scaleY).toBeCloseTo(30, 1);
      expect(result.offsetX).toBeCloseTo(-15, 1);
      expect(result.offsetY).toBeCloseTo(-15, 1);
    });

   it('farklı ölçekler', () => {
      const imgBounds = { xMin: 0, xMax: 2, yMin: 0, yMax: 1 };
      const csvBounds = { xMin: 0, xMax: 60, yMin: 0, yMax: 30 };

      aligner.autoAlign(imgBounds, csvBounds);

      expect(aligner.transform.scaleX).toBeCloseTo(30, 1);
      expect(aligner.transform.scaleY).toBeCloseTo(30, 1);
    });
  });

  describe('addControlPoint', () => {
    it('nokta ekleme', () => {
      aligner.addControlPoint(0.2, 0.3, -10, -8);
      expect(aligner.controlPoints.length).toBe(1);
    });

    it('2 nokta ile dönüşüm', () => {
      aligner.addControlPoint(0, 0, -15, -15);
      const result = aligner.addControlPoint(1, 1, 15, 15);

      expect(result).not.toBeNull();
      expect(aligner.mode).toBe('manual');
      expect(result.scaleX).toBeCloseTo(30, 1);
      expect(result.scaleY).toBeCloseTo(30, 1);
    });

    it('3 nokta ile RMSE hesaplama', () => {
      aligner.addControlPoint(0, 0, -15, -15);
      aligner.addControlPoint(1, 1, 15, 15);
      aligner.addControlPoint(0.5, 0.5, 0, 0);

      const result = aligner.computeManualTransform();
      expect(result.rmse).toBeCloseTo(0, 2); // Perfect alignment
    });

    it('mükerrer nokta güncelleme', () => {
      aligner.addControlPoint(0.5, 0.5, 0, 0);
      aligner.addControlPoint(0.5, 0.5, 5, 5);
      expect(aligner.controlPoints.length).toBe(1);
      expect(aligner.controlPoints[0].csvX).toBe(5);
    });
  });

  describe('imageToCsv / csvToImage', () => {
    beforeEach(() => {
      aligner.autoAlign(
        { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
        { xMin: -15, xMax: 15, yMin: -15, yMax: 15 }
      );
    });

    it('image → csv dönüşümü', () => {
      const csv = aligner.imageToCsv(0.5, 0.5);
      expect(csv.x).toBeCloseTo(0, 1);
      expect(csv.y).toBeCloseTo(0, 1);
    });

    it(' köşe noktaları', () => {
      const topLeft = aligner.imageToCsv(0, 0);
      expect(topLeft.x).toBeCloseTo(-15, 1);
      expect(topLeft.y).toBeCloseTo(-15, 1);

      const bottomRight = aligner.imageToCsv(1, 1);
      expect(bottomRight.x).toBeCloseTo(15, 1);
      expect(bottomRight.y).toBeCloseTo(15, 1);
    });

    it('csv → image dönüşümü (ters)', () => {
      const img = aligner.csvToImage(0, 0);
      expect(img.x).toBeCloseTo(0.5, 1);
      expect(img.y).toBeCloseTo(0.5, 1);
    });

    it('çift yönlü tutarlılık', () => {
      const original = { x: 0.3, y: 0.7 };
      const csv = aligner.imageToCsv(original.x, original.y);
      const back = aligner.csvToImage(csv.x, csv.y);
      expect(back.x).toBeCloseTo(original.x, 4);
      expect(back.y).toBeCloseTo(original.y, 4);
    });
  });

  describe('transformImageGrid', () => {
    it('toplu image → csv dönüşümü', () => {
      aligner.autoAlign(
        { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
        { xMin: -15, xMax: 15, yMin: -15, yMax: 15 }
      );

      const grid = [
        { x: 0, y: 0, nT: 100 },
        { x: 0.5, y: 0.5, nT: 0 },
        { x: 1, y: 1, nT: -100 },
      ];

      const result = aligner.transformImageGrid(grid);

      expect(result[0].csvX).toBeCloseTo(-15, 1);
      expect(result[0].csvY).toBeCloseTo(-15, 1);
      expect(result[1].csvX).toBeCloseTo(0, 1);
      expect(result[2].csvX).toBeCloseTo(15, 1);
      expect(result[2].nT).toBe(-100); // Orijinal veri korunur
    });
  });

  describe('qualityCheck', () => {
    it('dönüşüm yoksa kötü', () => {
      const q = aligner.qualityCheck();
      expect(q.quality).toBe('kötü');
      expect(q.score).toBe(0);
    });

    it('otomatik mod → iyi', () => {
      aligner.autoAlign(
        { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
        { xMin: -15, xMax: 15, yMin: -15, yMax: 15 }
      );
      const q = aligner.qualityCheck();
      expect(q.quality).toBe('iyi');
      expect(q.score).toBeGreaterThanOrEqual(70);
    });

    it('2 manuel nokta → orta', () => {
      aligner.addControlPoint(0, 0, -15, -15);
      aligner.addControlPoint(1, 1, 15, 15);
      const q = aligner.qualityCheck();
      expect(q.score).toBeGreaterThan(0);
    });
  });

  describe('autoAlignFromData', () => {
    it('gerçek veri ile otomatik hizalama', () => {
      const imageGrid = [
        { x: 0, y: 0, nT: 100 },
        { x: 0.5, y: 0.5, nT: 0 },
        { x: 1, y: 1, nT: -100 },
      ];

      const csvPoints = [
        { x: -15, y: -15, magnetic: 400 },
        { x: 0, y: 0, magnetic: 300 },
        { x: 15, y: 15, magnetic: 200 },
      ];

      const aligner = autoAlignFromData(imageGrid, csvPoints);
      expect(aligner.mode).toBe('auto');
      expect(aligner.transform).not.toBeNull();
    });
  });

  describe('toJSON / fromJSON', () => {
    it('serileştirme ve geri yükleme', () => {
      aligner.autoAlign(
        { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
        { xMin: -15, xMax: 15, yMin: -15, yMax: 15 }
      );
      aligner.addControlPoint(0.5, 0.5, 0, 0);

      const json = aligner.toJSON();
      const restored = CoordinateAligner.fromJSON(json);

      expect(restored.mode).toBe('auto');
      expect(restored.transform.scaleX).toBeCloseTo(30, 1);
      expect(restored.controlPoints.length).toBe(1);
    });
  });
});

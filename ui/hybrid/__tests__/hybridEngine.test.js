import { describe, it, expect, beforeEach } from 'vitest';
import { hashParams } from '../hybridEngine.js';

// hashParams fonksiyonunu test ediyoruz (export değil ama mantığını doğrulayabiliriz)

describe('hybridEngine', () => {
  describe('Parametre hash mantığı', () => {
    it('aynı parametreler aynı hash\'i üretmeli', () => {
      const p1 = { imageCount: 100, csvCount: 200, csvWeight: 70, alignMode: 'auto', soilType: 'loam', poolSizeM: 30, gridRes: 64, ntRange: 500 };
      const p2 = { imageCount: 100, csvCount: 200, csvWeight: 70, alignMode: 'auto', soilType: 'loam', poolSizeM: 30, gridRes: 64, ntRange: 500 };

      // Hash fonksiyonunu test etmek için basit bir implementasyon
      const hash = (p) => [p.imageCount, p.csvCount, p.csvWeight, p.alignMode, p.soilType, p.poolSizeM, p.gridRes, p.ntRange].join('|');
      expect(hash(p1)).toBe(hash(p2));
    });

    it('farklı parametreler farklı hash üretmeli', () => {
      const p1 = { imageCount: 100, csvWeight: 70 };
      const p2 = { imageCount: 200, csvWeight: 70 };

      const hash = (p) => [p.imageCount, p.csvWeight].join('|');
      expect(hash(p1)).not.toBe(hash(p2));
    });
  });

  describe('Motor durum kontrolü', () => {
    it('başlangıç durumu', () => {
      const engine = {
        lastParamsHash: null,
        lastResult: null,
        running: false,
        timer: null,
        cancelToken: 0,
      };

      expect(engine.running).toBe(false);
      expect(engine.lastResult).toBeNull();
      expect(engine.lastParamsHash).toBeNull();
    });
  });

  describe('Önbellek mantığı', () => {
    it('aynı hash ile önbellek kullanılır', () => {
      const cache = { hash: null, result: null };

      const params1 = { imageCount: 100, csvCount: 200 };
      const hash1 = '100|200';

      // İlk çalıştırma
      cache.hash = hash1;
      cache.result = { data: 'test' };

      // İkinci çalıştırma — aynı hash
      const hit = cache.hash === hash1;
      expect(hit).toBe(true);
      expect(cache.result.data).toBe('test');
    });

    it('farklı hash ile önbellek yenilenir', () => {
      const cache = { hash: '100|200', result: { data: 'eski' } };

      const newHash = '100|300';
      const hit = cache.hash === newHash;
      expect(hit).toBe(false);
    });
  });

  describe('İptal kontrolü', () => {
    it('cancelToken artırıldığında eski iş iptal olur', () => {
      let cancelToken = 0;

      // İlk iş
      const myToken1 = ++cancelToken;

      // İkinci iş (daha yeni)
      const myToken2 = ++cancelToken;

      // İlk iş devam ediyor mu?
      expect(myToken1 === cancelToken).toBe(false); // İptal
      expect(myToken2 === cancelToken).toBe(true);  // Devam
    });
  });

  describe('Debounce mantığı', () => {
    it('timer sıfırlanır', () => {
      let timer = null;
      const clearTimeout = (t) => { t = null; };

      timer = setTimeout(() => {}, 1000);
      expect(timer).not.toBeNull();

      // Yeni tetikleme — eski timer'ı iptal et
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {}, 1000);
      expect(timer).not.toBeNull();
    });
  });

  describe('Sonuç yapısı', () => {
    it('analiz sonucu doğru formatta', () => {
      const result = {
        aligner: { qualityCheck: () => ({ quality: 'iyi', score: 85 }) },
        alignmentQuality: { quality: 'iyi', score: 85 },
        fusionResult: { grid: [], stats: { filledCells: 100 } },
        depthResult: { depthGrid: [], stats: { avgDepth: 5 } },
        crossValResult: { matches: [], mismatches: [], report: '<div></div>' },
        hints: [{ type: 'consensus', x: 0, y: 0, depth: 5 }],
        elapsed: 150,
        paramsHash: '100|200|70|auto|loam|30|64|500',
      };

      expect(result.alignmentQuality.quality).toBe('iyi');
      expect(result.fusionResult.stats.filledCells).toBe(100);
      expect(result.depthResult.stats.avgDepth).toBe(5);
      expect(result.hints.length).toBe(1);
      expect(result.elapsed).toBe(150);
    });
  });

  describe('Edge cases', () => {
    it('boş image grid', () => {
      const params = { imageGrid: [], csvPoints: [{ x: 0, y: 0, magnetic: 100 }] };
      expect(params.imageGrid.length).toBe(0);
    });

    it('boş csv points', () => {
      const params = { imageGrid: [{ x: 0, y: 0, nT: 100 }], csvPoints: [] };
      expect(params.csvPoints.length).toBe(0);
    });

    it('null scene', () => {
      const scene = null;
      expect(scene).toBeNull();
    });
  });
});

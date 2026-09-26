/**
 * autoTune.test.js — AUTO Akıllı Ayarlar birim testleri
 *
 * Test edilenler:
 *   1. dataProfiler.profileCsv — istatistik doğruluğu
 *   2. dataProfiler.hashProfile — kararlı parmak izi
 *   3. autoTune.computeSuggestions — kural seti (gürültülü/temiz/boşluklu)
 *   4. autoTune önerileri parametre sınırları içinde kalır
 *   5. Öğrenme döngüsü — kullanıcı override'ı sonraki öneriye yansır
 *
 * Not: DOM (document) bu ortamda yoktur — UI bağlama testleri
 * elle (Tauri dev) yapılır; burada saf hesap katmanı test edilir.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { profileCsv, hashProfile } from "../dataProfiler.js";
import {
  computeSuggestions,
  getRuleIds,
  getParamGuide,
  recordUserOverride,
  getLearned,
  resetLearning,
  getLearningStats,
} from "../autoTune.js";

/* ── localStorage mock (test ortamı Node — DOM yok) ───── */

function installLocalStorageMock() {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
  return ls;
}

/* ── Yardımcı: sentetik CSV üret ───────────────────────── */

/** Deterministik sentetik nokta seti (rastgelelik yok — test tekrarlanabilir) */
function makePoints(n, opts = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = 10 + (i % 10) + (i / n) * 10; // 10..~20
    const y = 5 + Math.floor(i / 10) + (i / n) * 5; // 5..~15
    // Temiz: dar gürültü; Gürültülü: geniş gürültü
    let noise;
    if (opts.clean) {
      // Dar gürültü + birkaç belirgin anomali tepesi (gerçek sensör profili)
      noise = Math.sin(i) * 4 + (i % 25 === 0 ? 250 : 0);
    } else {
      noise = Math.sin(i * 7.13) * 200 + Math.cos(i * 3.7) * 150;
    }
    const base = opts.clean ? 50 : 0;
    pts.push({ x, y, magnetic: base + noise, z: -Math.abs(Math.sin(i)) * 5 });
  }
  return pts;
}

function makeCsv(points, bounds) {
  const b = bounds || {
    xMin: Math.min(...points.map((p) => p.x)),
    xMax: Math.max(...points.map((p) => p.x)),
    yMin: Math.min(...points.map((p) => p.y)),
    yMax: Math.max(...points.map((p) => p.y)),
  };
  return { points, bounds: b };
}

/** Elle inşa edilmiş profil — kural testleri için deterministik */
function syntheticCsvProfile(over = {}) {
  return {
    kind: "csv",
    pointCount: 500,
    areaM2: 600,
    widthM: 30,
    heightM: 20,
    density: 0.8,
    mMin: -50,
    mMax: 250,
    mean: 20,
    std: 15,
    snr: 3.0,
    gapRatio: 0.05,
    ...over,
  };
}

/* ── dataProfiler.profileCsv ───────────────────────────── */

describe("profileCsv", () => {
  it("nokta sayısı ve alanı doğru ölçer", () => {
    const pts = [];
    for (let i = 0; i < 100; i++) pts.push({ x: 10 + (i % 10), y: 5 + Math.floor(i / 10), magnetic: 10 });
    const p = profileCsv(makeCsv(pts));
    expect(p).not.toBeNull();
    expect(p.pointCount).toBe(100);
    // x: 10..19 (genişlik 9), y: 5..14 (yükseklik 9) → 81m²
    expect(p.areaM2).toBeCloseTo(81, 0);
    expect(p.density).toBeGreaterThan(1);
  });

  it("az veride null döner", () => {
    expect(profileCsv({ points: [{ x: 1, y: 2, magnetic: 3 }], bounds: {} })).toBeNull();
    expect(profileCsv(null)).toBeNull();
  });

  it("temiz veride SNR, gürültülüden yüksek", () => {
    const clean = profileCsv(makeCsv(makePoints(400, { clean: true })));
    const noisy = profileCsv(makeCsv(makePoints(400, {})));
    expect(clean.snr).toBeGreaterThan(noisy.snr);
  });

  it("grid boşluk oranı 0-1 arasında", () => {
    const p = profileCsv(makeCsv(makePoints(400, { clean: true })));
    expect(p.gapRatio).toBeGreaterThanOrEqual(0);
    expect(p.gapRatio).toBeLessThanOrEqual(1);
  });
});

/* ── dataProfiler.hashProfile ──────────────────────────── */

describe("hashProfile", () => {
  it("aynı veri her zaman aynı anahtarı verir", () => {
    const csv = profileCsv(makeCsv(makePoints(400, { clean: true })));
    const h1 = hashProfile({ image: null, csv, sources: ["csv"] });
    const h2 = hashProfile({ image: null, csv, sources: ["csv"] });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^csv-/);
  });

  it("bucket'lanmış değerler anahtara girer", () => {
    const p = syntheticCsvProfile();
    const h = hashProfile({ image: null, csv: p, sources: ["csv"] });
    expect(h).toContain("csv-d1");
    expect(h).toContain("s3");
  });

  it("boş profil 'none' döner", () => {
    expect(hashProfile(null)).toBe("none");
    expect(hashProfile({ image: null, csv: null, sources: [] })).toBe("none");
  });
});

/* ── computeSuggestions kuralları ──────────────────────── */

describe("computeSuggestions", () => {
  it("gürültülü veride eşik yükselir, temizde düşer", () => {
    const noisy = { image: null, csv: syntheticCsvProfile({ snr: 1.0 }), sources: ["csv"] };
    const clean = { image: null, csv: syntheticCsvProfile({ snr: 3.2 }), sources: ["csv"] };
    const noisySug = computeSuggestions(noisy, "none");
    const cleanSug = computeSuggestions(clean, "none");
    const noisyThr = noisySug.find((s) => s.id === "csv-threshold");
    const cleanThr = cleanSug.find((s) => s.id === "csv-threshold");
    expect(noisyThr.value).toBeGreaterThan(cleanThr.value);
    // Gerekçe metni de kaliteyi açıklamalı
    expect(noisyThr.reason).toMatch(/Gürültülü|SNR/i);
  });

  it("gürültülü veride min güç yükselir", () => {
    const noisy = { image: null, csv: syntheticCsvProfile({ snr: 1.0 }), sources: ["csv"] };
    const clean = { image: null, csv: syntheticCsvProfile({ snr: 3.2 }), sources: ["csv"] };
    const nMin = computeSuggestions(noisy, "none").find((s) => s.id === "csv-min-strength");
    const cMin = computeSuggestions(clean, "none").find((s) => s.id === "csv-min-strength");
    expect(nMin.value).toBeGreaterThan(cMin.value);
  });

  it("boşluklu taramada sigma yumuşatma artar", () => {
    const gapless = { image: null, csv: syntheticCsvProfile({ gapRatio: 0.05 }), sources: ["csv"] };
    const gappy = { image: null, csv: syntheticCsvProfile({ gapRatio: 0.4 }), sources: ["csv"] };
    const s1 = computeSuggestions(gapless, "none").find((s) => s.id === "csv-sigma");
    const s2 = computeSuggestions(gappy, "none").find((s) => s.id === "csv-sigma");
    expect(s2.value).toBeGreaterThan(s1.value);
  });

  it("havuz boyutu saha kenarına göre ölçeklenir", () => {
    const p = { image: null, csv: syntheticCsvProfile({ widthM: 40, heightM: 20 }), sources: ["csv"] };
    const sug = computeSuggestions(p, "none").find((s) => s.id === "csv-pool-size");
    // 40m kenar × 1.25 = 50
    expect(sug.value).toBe(50);
  });

  it("tek kaynakta hibrit ağırlık önerilmez", () => {
    const sug = computeSuggestions({ image: null, csv: syntheticCsvProfile(), sources: ["csv"] }, "none");
    expect(sug.find((s) => s.id === "unified-csv-weight")).toBeUndefined();
  });

  it("çift kaynakta hibrit ağırlık önerilir", () => {
    const both = {
      image: { kind: "image", redRatio: 0.2, greenRatio: 0.5, blueRatio: 0.05, lutOk: true, anomalyLoad: 0.6 },
      csv: syntheticCsvProfile({ snr: 3.0 }),
      sources: ["image", "csv"],
    };
    const sug = computeSuggestions(both, "none");
    expect(sug.find((s) => s.id === "unified-csv-weight")).toBeDefined();
  });

  it("tüm öneriler parametre sınırları içinde kalır", () => {
    const sug = computeSuggestions({ image: null, csv: syntheticCsvProfile({ snr: 0.2, gapRatio: 0.9, density: 50 }), sources: ["csv"] }, "none");
    const guide = getParamGuide();
    expect(sug.length).toBeGreaterThan(3);
    for (const s of sug) {
      const g = guide[s.id];
      expect(g).toBeDefined();
      expect(s.value).toBeGreaterThanOrEqual(g.min);
      expect(s.value).toBeLessThanOrEqual(g.max);
    }
  });

  it("veri yoksa öneri listesi boştur", () => {
    const sug = computeSuggestions({ image: null, csv: null, sources: [] }, "none");
    expect(sug).toHaveLength(0);
  });
});

/* ── Öğrenme döngüsü ───────────────────────────────────── */

describe("öğrenme döngüsü (feedback)", () => {
  beforeEach(() => {
    installLocalStorageMock();
    resetLearning();
  });

  it("kullanıcı override'ı aynı profilde öneriye yansır", () => {
    const key = "csv-d1-s2-g10-a600";
    recordUserOverride(key, "csv-grid-res", 48);

    const learned = getLearned(key);
    expect(learned).not.toBeNull();
    expect(learned["csv-grid-res"].value).toBe(48);

    const sug = computeSuggestions({ image: null, csv: syntheticCsvProfile(), sources: ["csv"] }, key);
    const grid = sug.find((s) => s.id === "csv-grid-res");
    expect(grid.value).toBe(48);
    expect(grid.learned).toBe(true);
  });

  it("öğrenilen gerekçe etiketi taşır", () => {
    const key = "csv-d1-s2-g10-a600";
    recordUserOverride(key, "csv-sigma", 3.5);
    const sug = computeSuggestions({ image: null, csv: syntheticCsvProfile(), sources: ["csv"] }, key);
    const sigma = sug.find((s) => s.id === "csv-sigma");
    expect(sigma.learned).toBe(true);
    expect(sigma.reason).toMatch(/tercih/i);
  });

  it("sınır dışı override clamp'lenir", () => {
    const key = "csv-d1-s2-g10-a600";
    recordUserOverride(key, "csv-grid-res", 500); // max 64
    const learned = getLearned(key);
    expect(learned["csv-grid-res"].value).toBe(64);
  });

  it("resetLearning kaydı temizler", () => {
    const key = "csv-d1-s2-g10-a500";
    recordUserOverride(key, "csv-sigma", 3.5);
    resetLearning();
    expect(getLearned(key)).toBeNull();
  });

  it("öğrenme istatistiği doğru sayar", () => {
    const key = "csv-d1-s2-g10-a600";
    recordUserOverride(key, "csv-grid-res", 48);
    recordUserOverride(key, "csv-sigma", 3);
    const st = getLearningStats();
    expect(st.totalOverrides).toBe(2);
    expect(st.profileCount).toBe(1);
  });
});

/* ── Kural envanteri ───────────────────────────────────── */

describe("kural envanteri", () => {
  it("10 kritik parametre için kural tanımlı", () => {
    const ids = getRuleIds();
    expect(ids).toContain("csv-threshold");
    expect(ids).toContain("csv-grid-res");
    expect(ids).toContain("main-sensitivity-slider");
    expect(ids).toContain("unified-csv-weight");
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });
});

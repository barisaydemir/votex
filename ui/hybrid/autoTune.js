/**
 * autoTune.js — AUTO Akıllı Ayarlar · Kural Tabanlı Parametre Motoru
 *
 * Veri profiline (dataProfiler.js) bakarak analiz parametrelerini otomatik önerir.
 * Öğrenme döngüsü: kullanıcı AUTO sonrası bir slider'ı elle değiştirirse,
 * aynı profil tipinde sonraki sefere o değer önerilir (localStorage).
 *
 * Tamamen bağımsız — silindiğinde hiçbir şey bozulmaz.
 *
 * Kullanım:
 *   import { computeSuggestions, applySuggestions, hashProfile } from "./autoTune.js";
 *   const suggestions = computeSuggestions(profile, hashProfile(profile));
 *   applySuggestions(suggestions); // DOM slider'larına yazar
 */

/* ── Parametre Rehberi (DOM slider id → sınırlar) ──────── */

const PARAM_GUIDE = {
  "csv-pool-size":     { min: 10,   max: 100,  step: 5 },
  "csv-fit":           { min: 50,   max: 100,  step: 5 },
  "csv-point-size":    { min: 0.05, max: 1.0,  step: 0.05 },
  "csv-slice-count":   { min: 4,    max: 16,   step: 1 },
  "csv-threshold":     { min: 0.3,  max: 2.0,  step: 0.05 },
  "csv-min-strength":  { min: 0.05, max: 1.0,  step: 0.05 },
  "csv-grid-res":      { min: 8,    max: 64,   step: 1 },
  "csv-sigma":         { min: 1,    max: 4,    step: 0.5 },
  "unified-csv-weight":{ min: 0,    max: 100,  step: 5 },
  "min-confidence":    { min: 25,   max: 70,   step: 5 }, // UI % cinsinden (25-70 → 0.25-0.70)
};

const FEEDBACK_KEY = "votex.autotune.feedback.v1";
const FEEDBACK_MAX_KEYS = 60;

/* ── Yardımcılar ─────────────────────────────────────── */

function clamp(value, guide) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  return Math.max(guide.min, Math.min(guide.max, v));
}

/** Profil kalite sınıfı — kuralların ortak dili */
function qualityClass(profile) {
  const csv = profile?.csv;
  const img = profile?.image;
  if (csv) {
    if (csv.snr < 1.5) return "noisy";
    if (csv.snr < 2.5) return "normal";
    return "clean";
  }
  if (img) {
    if (!img.lutOk) return "noisy";
    if (img.anomalyLoad > 0.6) return "normal";
    return "clean";
  }
  return "normal";
}

/* ── Kural Seti ───────────────────────────────────────── */

/**
 * Her kural: (profile) → { value, reason } ya da null (önerme).
 * Kurallar veri istatistiğine dayalı, deterministik ve açıklanabilir.
 */
const RULES = {
  /* Havuz boyutu: CSV alanının en büyük kenarını ~1.25 kat ört */
  "csv-pool-size": (p) => {
    const csv = p.csv;
    if (!csv) return null;
    const span = Math.max(csv.widthM, csv.heightM);
    const val = clamp(span * 1.25, PARAM_GUIDE["csv-pool-size"]);
    if (val == null) return null;
    return { value: val, reason: `Saha en geniş kenarı ${span.toFixed(0)}m` };
  },

  /* Sığdırma payı: boşluklu taramada kutuyu biraz daha doldur */
  "csv-fit": (p) => {
    const csv = p.csv;
    if (!csv) return null;
    const val = csv.gapRatio > 0.3 ? 90 : csv.gapRatio > 0.15 ? 88 : 85;
    return {
      value: clamp(val, PARAM_GUIDE["csv-fit"]),
      reason: csv.gapRatio > 0.15
        ? `Tarama boşluklu (gap %${Math.round(csv.gapRatio * 100)})`
        : "Tarama düzenli",
    };
  },

  /* Nokta boyutu: yoğun veride küçük göster */
  "csv-point-size": (p) => {
    const csv = p.csv;
    if (!csv) return null;
    const val = csv.density > 5 ? 0.1 : csv.density > 1 ? 0.15 : 0.2;
    return { value: clamp(val, PARAM_GUIDE["csv-point-size"]), reason: `${csv.density.toFixed(1)} nokta/m²` };
  },

  /* Dilim sayısı: büyük sahada daha çok dilim */
  "csv-slice-count": (p) => {
    const csv = p.csv;
    if (!csv) return null;
    const val = csv.areaM2 > 800 ? 12 : csv.areaM2 > 300 ? 10 : 8;
    return { value: clamp(val, PARAM_GUIDE["csv-slice-count"]), reason: `Alan ${csv.areaM2.toFixed(0)}m²` };
  },

  /* Tespit eşiği: gürültülü veride yükselt, temizde düşür */
  "csv-threshold": (p) => {
    const q = qualityClass(p);
    if (!p.csv) return null;
    const val = q === "noisy" ? 1.3 : q === "normal" ? 0.9 : 0.6;
    return {
      value: clamp(val, PARAM_GUIDE["csv-threshold"]),
      reason: q === "noisy" ? `Gürültülü veri (SNR ${p.csv.snr.toFixed(1)})` : q === "normal" ? "SNR normal" : `Temiz veri (SNR ${p.csv.snr.toFixed(1)})`,
    };
  },

  /* Min güç: gürültüde yükselt, temizde düşür */
  "csv-min-strength": (p) => {
    const q = qualityClass(p);
    if (!p.csv) return null;
    const val = q === "noisy" ? 0.6 : q === "normal" ? 0.45 : 0.35;
    return { value: clamp(val, PARAM_GUIDE["csv-min-strength"]), reason: "Gürültü eşiği" };
  },

  /* Grid çözünürlüğü: nokta yoğunluğuna göre */
  "csv-grid-res": (p) => {
    const csv = p.csv;
    if (!csv) return null;
    const val = csv.density < 0.5 ? 16 : csv.density <= 2 ? 32 : 48;
    return { value: clamp(val, PARAM_GUIDE["csv-grid-res"]), reason: `${csv.pointCount} nokta` };
  },

  /* Sigma: boşluklu taramada yumuşatma artar */
  "csv-sigma": (p) => {
    const csv = p.csv;
    if (!csv) return null;
    const val = csv.gapRatio > 0.3 ? 3 : csv.gapRatio > 0.15 ? 2.5 : 2;
    return { value: clamp(val, PARAM_GUIDE["csv-sigma"]), reason: "Ara değerleme gücü" };
  },

  /* Hibrit ağırlık: iki kaynak varsa kaliteye göre paylaş */
  "unified-csv-weight": (p) => {
    if (!p.image || !p.csv) return null; // tek kaynak: değiştirme
    let val = 70;
    let reason = "CSV birincil kaynak";
    if (!p.image.lutOk) { val = 80; reason = "Görsel renk şeridi zayıf"; }
    else if (p.csv.snr > 2.5 && p.image.anomalyLoad > 0.5) { val = 50; reason = "İki kaynak da güçlü — 50/50"; }
    else if (p.csv.snr < 1.5) { val = 60; reason = "CSV gürültülü — görsel payı arttı"; }
    return { value: clamp(val, PARAM_GUIDE["unified-csv-weight"]), reason };
  },

  /* Min güven: kaliteye göre — gürültülüde yüksek eşik yanlış pozitifi önler */
  "min-confidence": (p) => {
    if (!p.image && !p.csv) return null; // veri yokken önerme
    const q = qualityClass(p);
    // UI yüzde: 25-70
    const val = q === "clean" ? 40 : q === "normal" ? 40 : 45;
    const reason = q === "noisy" ? "Gürültülü veri — yüksek güven eşiği" : "Standart güven eşiği";
    // Yüzde olarak dönsün (25-70 aralığı UI'da yüzde)
    const pct = clamp(val, PARAM_GUIDE["min-confidence"]);
    return pct == null ? null : { value: pct, reason };
  },
};

/* ── Öneri Hesaplama ─────────────────────────────────── */

/**
 * Profil + öğrenilmiş tercihlerden parametre önerileri üret.
 *
 * @param {Object} profile - buildProfile() sonucu
 * @param {string} [profileKey] - hashProfile() sonucu (öğrenme anahtarı)
 * @returns {Array<{id, value, reason, learned}>} öneri listesi
 */
export function computeSuggestions(profile, profileKey) {
  const out = [];
  const learned = getLearned(profileKey);

  for (const [id, rule] of Object.entries(RULES)) {
    const res = rule(profile);
    if (!res || res.value == null) continue;

    // Öğrenilmiş değer varsa önceliklidir
    const learnedEntry = learned?.[id];
    if (learnedEntry != null) {
      const guide = PARAM_GUIDE[id];
      const lv = clamp(learnedEntry.value, guide);
      if (lv != null) {
        out.push({ id, value: lv, reason: "Önceki tercihiniz", learned: true });
        continue;
      }
    }
    out.push({ id, value: res.value, reason: res.reason, learned: false });
  }
  return out;
}

/* ── DOM Uygulama ────────────────────────────────────── */

/**
 * Önerileri DOM slider'larına uygular (value yazar, input+change event tetikler).
 * DOM elemanı yoksa sessizce atlanır.
 *
 * @param {Array<{id, value}>} suggestions
 * @param {(id: string) => void} [onParamChange] - her değişimde geri çağrı
 * @returns {{ applied: Array<{id, oldValue, newValue}>, skipped: string[] }}
 */
export function applySuggestions(suggestions, onParamChange) {
  const applied = [];
  const skipped = [];
  for (const s of suggestions || []) {
    const el = document.getElementById(s.id);
    if (!el || s.value == null) { skipped.push(s.id); continue; }
    const oldValue = Number(el.value);
    const newValue = clamp(s.value, PARAM_GUIDE[s.id] || { min: -Infinity, max: Infinity, step: 0.01 });
    if (newValue == null) { skipped.push(s.id); continue; }
    el.value = String(newValue);
    // Bağlı etiketler ve yeniden hesaplamalar event ile uyanır
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (onParamChange) onParamChange(s.id);
    applied.push({ id: s.id, oldValue, newValue });
  }
  return { applied, skipped };
}

/** Parametre rehberini dışa aç (test/panel için) */
export function getParamGuide() {
  return { ...PARAM_GUIDE };
}

/** Kural listesinin id'leri (test için) */
export function getRuleIds() {
  return Object.keys(RULES);
}

/* ── Öğrenme Döngüsü (Feedback Store) ────────────────── */

function readStore() {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    // Boyut sınırla — en eski anahtarları at
    const keys = Object.keys(store);
    if (keys.length > FEEDBACK_MAX_KEYS) {
      const sorted = keys.sort((a, b) => (store[a].lastAt || 0) - (store[b].lastAt || 0));
      for (const k of sorted.slice(0, keys.length - FEEDBACK_MAX_KEYS)) delete store[k];
    }
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn("[AutoTune] Feedback kaydı yazılamadı:", e);
  }
}

/**
 * Kullanıcı AUTO'dan sonra bir parametreyi elle değiştirdi — öğren.
 *
 * @param {string} profileKey - hashProfile() sonucu
 * @param {string} paramId - slider id
 * @param {number} userValue - kullanıcının tercih ettiği değer
 */
export function recordUserOverride(profileKey, paramId, userValue) {
  if (!profileKey || !paramId || profileKey === "none") return;
  const guide = PARAM_GUIDE[paramId];
  if (!guide) return;
  const v = clamp(userValue, guide);
  if (v == null) return;

  const store = readStore();
  if (!store[profileKey]) store[profileKey] = { overrides: {}, lastAt: 0 };
  const o = store[profileKey].overrides;
  if (!o[paramId]) o[paramId] = { value: v, count: 0, lastAt: 0 };
  o[paramId].value = v;
  o[paramId].count = (o[paramId].count || 0) + 1;
  o[paramId].lastAt = Date.now();
  store[profileKey].lastAt = Date.now();
  writeStore(store);
}

/** Bir profil için öğrenilmiş tercihleri getir */
export function getLearned(profileKey) {
  if (!profileKey || profileKey === "none") return null;
  const store = readStore();
  return store[profileKey]?.overrides || null;
}

/** Tüm öğrenme kaydını sıfırla */
export function resetLearning() {
  try {
    localStorage.removeItem(FEEDBACK_KEY);
  } catch { /* yoksay */ }
}

/** Öğrenme durumu özeti (panel gösterimi için) */
export function getLearningStats() {
  const store = readStore();
  const keys = Object.keys(store);
  let totalOverrides = 0;
  for (const k of keys) {
    totalOverrides += Object.keys(store[k]?.overrides || {}).length;
  }
  return { profileCount: keys.length, totalOverrides };
}

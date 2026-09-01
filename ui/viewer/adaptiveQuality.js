/**
 * adaptiveQuality.js — FPS tabanlı otomatik kalite kademesi.
 *
 * Render-on-demand döngüsünde yalnızca **art arda çizilen kareler** ölçülür
 * (kamera sürükleme, damping, uçuş). Sahne boşta dururken hiçbir şey
 * ölçülmez — boşta CPU/GPU maliyeti sıfırdır.
 *
 * Ortalama FPS eşiği aşırsa kademe değişir:
 *   ↓ düşük FPS  → piksel oranı ve gölge çözünürlüğü kademeli azalır,
 *                  en dipte gölge tamamen kapanır.
 *   ↑ yüksek FPS → uzun süre kararlıysa tek tek geri yükselir.
 *
 * Sallanmayı (oscillation) önlemek için: düşürme kısa bekleme sonrası
 * serbesttir; yükseltme ise uzun süreli kararlılık ister.
 */
import { state } from "../app/state.js";
import { logLine } from "../ui/telemetry.js";

/** Kademe 0 = en yüksek kalite. shadowSize 0 = gölge kapalı. */
export const TIERS = [
  { label: "Tam", maxPixelRatio: 2.0, shadowSize: 2048 },
  { label: "Dengeli", maxPixelRatio: 1.5, shadowSize: 1024 },
  { label: "Performans", maxPixelRatio: 1.2, shadowSize: 1024 },
  { label: "Uyumluluk", maxPixelRatio: 1.0, shadowSize: 0 },
];

const FPS_DOWN = 38; // altında → kademe düşür
const FPS_UP = 57; // uzun süre üstünde → kademe yükselt
const ACTIVE_GAP_MS = 250; // iki kare arası bu kadar açılırsa "boşta" sayılır
const MIN_SAMPLES = 20; // karar için en az bu kadar ardışık kare deltası
const EVAL_INTERVAL_MS = 900; // en sık bu aralıkla değerlendir
const DOWNGRADE_COOLDOWN_MS = 2500;
const UPGRADE_COOLDOWN_MS = 12000;

let tier = 0;
let samples = [];
let lastFrameAt = 0;
let lastEvalAt = 0;
let lastChangeAt = 0;
let changeListeners = [];

/**
 * Saf karar fonksiyonu (birim test edilir).
 * @returns {number} yeni kademe (değişmediyse mevcut kademe)
 */
export function decideTier(avgFps, currentTier, { downOk = true, upOk = true } = {}) {
  if (!Number.isFinite(avgFps)) return currentTier;
  if (avgFps < FPS_DOWN && downOk && currentTier < TIERS.length - 1) return currentTier + 1;
  if (avgFps > FPS_UP && upOk && currentTier > 0) return currentTier - 1;
  return currentTier;
}

export function getTier() {
  return tier;
}

export function getTierInfo() {
  return TIERS[tier];
}

export function onTierChange(cb) {
  changeListeners.push(cb);
}

function emitChange(prevTier) {
  const info = TIERS[tier];
  logLine(
    `Otomatik performans: "${TIERS[prevTier].label}" → "${info.label}" kademesine geçildi`,
    "warn"
  );
  for (const cb of changeListeners) {
    try {
      cb(tier, info);
    } catch {
      /* dinleyici hatası sahneyi bozmasın */
    }
  }
}

/** Piksel oranını ve gölge çözünürlüğünü mevcut kademeye uygula. */
function applyTier(info) {
  const renderer = state.renderer;
  if (!renderer) return;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  renderer.setPixelRatio(Math.min(dpr, info.maxPixelRatio));

  const sun = state.sunLight;
  if (sun?.shadow) {
    if (!info.shadowSize) {
      if (sun.castShadow) sun.castShadow = false;
    } else {
      if (!sun.castShadow) sun.castShadow = true;
      if (sun.shadow.mapSize.x !== info.shadowSize) {
        sun.shadow.mapSize.set(info.shadowSize, info.shadowSize);
        // Eski gölge haritasını boşalt → üç.js yeni boyutta yeniden ayırır
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
    }
  }
}

/**
 * Çizilen her karede çağrılır. Ardışık kare süresinden ortalama FPS hesaplar,
 * eşik aşılırsa kademeyi değiştirip uygular.
 * @param {number} now performance.now() — çizim anı
 * @returns {boolean} kademe değiştiyse true
 */
export function noteRenderFrame(now) {
  if (lastFrameAt && now - lastFrameAt < ACTIVE_GAP_MS) {
    samples.push(now - lastFrameAt);
    if (samples.length > 90) samples.shift();
  } else {
    samples = []; // uzun aradan sonra taze ölçüm
  }
  lastFrameAt = now;

  if (samples.length < MIN_SAMPLES || now - lastEvalAt < EVAL_INTERVAL_MS) return false;
  lastEvalAt = now;

  const avgDelta = samples.reduce((a, b) => a + b, 0) / samples.length;
  const avgFps = 1000 / avgDelta;
  const prev = tier;
  tier = decideTier(
    avgFps,
    tier,
    {
      downOk: now - lastChangeAt >= DOWNGRADE_COOLDOWN_MS,
      upOk: now - lastChangeAt >= UPGRADE_COOLDOWN_MS,
    }
  );
  samples = []; // her değerlendirmeden sonra pencereyi yenile

  if (tier !== prev) {
    lastChangeAt = now;
    applyTier(TIERS[tier]);
    emitChange(prev);
    return true;
  }
  return false;
}

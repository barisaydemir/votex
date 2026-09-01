/**
 * colorBasedAnalysis.js — Renk-Bazlı Analiz Tekrarı
 *
 * Renklendirme şeması değiştiğinde analizi tekrar çalıştırır.
 * Orijinal (renksiz) analiz sonucu saklanır, renkli versiyonlar
 * ayrı önbellekte tutulur. "Kapalı" moduna geçince orijinale dönülür.
 *
 * Kullanım:
 *   import { initColorAnalysis, reanalyzeWithColor } from "./colorBasedAnalysis.js";
 *   initColorAnalysis();  // colorizer hook'unu bağla
 *
 * Tamamen bağımsız — silindiğinde hiçbir şey bozulmaz.
 */
import { state } from "../app/state.js";
import { invalidate } from "../viewer/scene.js";
import { PALETTES } from "../viewer/colorizer.js";
import { setStatus } from "../app/status.js";

/* ── Önbellek Yapısı ────────────────────────────────── */

/**
 * Her renk şeması için ayrı analiz sonucu.
 * key: paletteKey (örn: "magnetic", "ocean", "none")
 * value: { result, timestamp, analysisParams }
 */
const analysisCache = new Map();

/** Orijinal (renksiz) analiz sonucu — asla üzerine yazılmaz */
let originalResult = null;

/** Şu anki aktif renk şeması */
let activePalette = "none";

/** Tekrar analiz çalışıyor mu */
let reanalyzing = false;

/** Callback — analiz tamamlanınca çağrılır */
let onAnalysisComplete = null;

/* ── Public API ──────────────────────────────────────── */

/**
 * İlk analiz çalıştırıldığında çağrılır — orijinal sonucu saklar.
 * @param {Object} analysisResult — hybridEngine.runHybridAnalysis sonucu
 */
export function saveOriginalResult(analysisResult) {
  if (!analysisResult) return;
  originalResult = structuredClone(analysisResult);
  analysisCache.set("none", {
    result: originalResult,
    timestamp: Date.now(),
    label: "Orijinal (Renksiz)",
  });
  console.log(`[ColorAnalysis] Orijinal analiz saklandı (${Object.keys(analysisResult).length} alan)`);
}

/**
 * Renk şeması değiştiğinde çağrılır — önbellekten sonucu yükler
 * veya yeni analiz çalıştırır.
 * @param {string} paletteKey — yeni renk şeması
 * @param {Function} [runAnalysisFn] — analiz çalıştırıcı (async)
 * @returns {Promise<Object|null>} analiz sonucu
 */
export async function reanalyzeWithColor(paletteKey, runAnalysisFn) {
  if (paletteKey === "none") {
    // Orijinale dön
    activePalette = "none";
    const cached = analysisCache.get("none");
    console.log("[ColorAnalysis] Orijinal analize dönüldü");
    return cached?.result || originalResult || null;
  }

  activePalette = paletteKey;

  // Önbellekte var mı?
  const cached = analysisCache.get(paletteKey);
  if (cached) {
    console.log(`[ColorAnalysis] Önbellek kullanılıyor: ${paletteKey} (${cached.timestamp})`);
    return cached.result;
  }

  // Yoksa yeni analiz çalıştır
  if (!runAnalysisFn) {
    console.warn(`[ColorAnalysis] Analiz fonksiyonu verilmedi: ${paletteKey}`);
    return null;
  }

  if (reanalyzing) {
    console.log("[ColorAnalysis] Zaten çalışıyor — atlanıyor");
    return null;
  }

  reanalyzing = true;
  try {
    console.log(`[ColorAnalysis] Yeni analiz: ${paletteKey}`);
    setStatus(`Renk-bazlı analiz: ${PALETTES[paletteKey]?.label || paletteKey}...`);

    const result = await runAnalysisFn(paletteKey);
    if (result) {
      analysisCache.set(paletteKey, {
        result: structuredClone(result),
        timestamp: Date.now(),
        label: PALETTES[paletteKey]?.label || paletteKey,
      });
      console.log(`[ColorAnalysis] Analiz tamamlandı: ${paletteKey}`);
      if (onAnalysisComplete) onAnalysisComplete(paletteKey, result);
    }
    return result;
  } catch (err) {
    console.error(`[ColorAnalysis] Analiz hatası (${paletteKey}):`, err);
    return null;
  } finally {
    reanalyzing = false;
  }
}

/**
 * Belirli bir renk şemasının önbelleğini temizler.
 * @param {string} [paletteKey] — belirtilmezse hepsini temizler
 */
export function clearCache(paletteKey) {
  if (paletteKey) {
    analysisCache.delete(paletteKey);
    console.log(`[ColorAnalysis] Önbellek temizlendi: ${paletteKey}`);
  } else {
    analysisCache.clear();
    console.log("[ColorAnalysis] Tüm önbellek temizlendi");
  }
}

/**
 * Tüm önbelleği sıfırla + orijinal sonucu sil.
 */
export function resetAll() {
  analysisCache.clear();
  originalResult = null;
  activePalette = "none";
  reanalyzing = false;
  console.log("[ColorAnalysis] Tamamen sıfırlandı");
}

/**
 * Önbellek durumu hakkında bilgi ver.
 * @returns {Object} { keys, count, originalSaved, activePalette }
 */
export function getCacheStatus() {
  return {
    keys: [...analysisCache.keys()],
    count: analysisCache.size,
    originalSaved: !!originalResult,
    activePalette,
    reanalyzing,
  };
}

/**
 * Orijinal (renksiz) analiz sonucunu döndür.
 * @returns {Object|null}
 */
export function getOriginalResult() {
  return originalResult ? structuredClone(originalResult) : null;
}

/**
 * Belirli bir şemanın önbellek girişini döndür.
 * @param {string} paletteKey
 * @returns {Object|null} { result, timestamp, label }
 */
export function getCacheEntry(paletteKey) {
  const entry = analysisCache.get(paletteKey);
  if (!entry) return null;
  return {
    result: entry.result ? structuredClone(entry.result) : null,
    timestamp: entry.timestamp,
    label: entry.label,
  };
}

/**
 * Şu anki aktif renk şemasını döndür.
 */
export function getActivePalette() {
  return activePalette;
}

/**
 * Belirli bir şemanın önbellekte olup olmadığını kontrol et.
 * @param {string} paletteKey
 * @returns {boolean}
 */
export function isCached(paletteKey) {
  return analysisCache.has(paletteKey);
}

/**
 * Analiz tamamlanma callback'ini ayarla.
 * @param {Function} fn — (paletteKey, result) => void
 */
export function onAnalysisDone(fn) {
  onAnalysisComplete = fn;
}

/* ── Colorizer Hook ──────────────────────────────────── */

/**
 * colorizer.js'deki applyColorizer'ı sarmalar.
 * Renk değişince otomatik tetikleme yapar.
 *
 * @param {Function} originalApplyColorizer — orijinal applyColorizer
 * @param {Function} runAnalysisFn — analiz çalıştırıcı (async)
 * @returns {Function} sarmalanmış applyColorizer
 */
export function wrapColorizer(originalApplyColorizer, runAnalysisFn) {
  return async function patchedApplyColorizer(paletteKey) {
    // Önce renklendirmeyi uygula
    originalApplyColorizer(paletteKey);

    // Sonra analizi tekrar çalıştır
    await reanalyzeWithColor(paletteKey, runAnalysisFn);
  };
}

/**
 * Colorizer select'e "Tekrar Analiz" butonu ekler.
 * Veya select'e change event'i bağlar.
 */
/** Analiz fonksiyonu referansı */
let _analysisFn = null;

/**
 * Analiz fonksiyonunu kaydet — renk değişince bu kullanılacak.
 * @param {Function} fn — async (paletteKey) => analysisResult
 */
export function setAnalysisFunction(fn) {
  _analysisFn = typeof fn === "function" ? fn : null;
  console.log("[ColorAnalysis] Analiz fonksiyonu kaydedildi:", !!_analysisFn);
}

/** Kayıtlı analiz fonksiyonunu döndür. */
export function getAnalysisFunction() {
  return _analysisFn;
}

export function initColorAnalysis() {
  console.log("[ColorAnalysis] Başlatıldı — renk şeması değişiklikleri izleniyor");

  // Colorizer select'i izle
  const select = document.getElementById("colorizer-palette");
  if (select) {
    select.addEventListener("change", () => {
      const key = select.value;
      console.log(`[ColorAnalysis] Renk değişti: ${key}`);
    });
  }
}

/**
 * Durum rozeti HTML'i — sol menüde göstermek için.
 * @returns {string} HTML
 */
export function renderCacheStatusHTML() {
  const status = getCacheStatus();
  const palLabel = PALETTES[activePalette]?.label || "—";
  const cachedCount = status.count;

  return `
    <div style="font-size:0.75rem;opacity:0.7;margin-top:0.3rem;">
      Aktif: <strong>${palLabel}</strong>
      ${cachedCount > 0 ? ` · ${cachedCount} önbellek` : ""}
      ${status.originalSaved ? " · ✅ orijinal saklı" : ""}
      ${status.reanalyzing ? " · ⏳ analiz..." : ""}
    </div>
  `;
}

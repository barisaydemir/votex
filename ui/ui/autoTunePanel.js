/**
 * autoTunePanel.js — AUTO Akıllı Ayarlar · Öneri Kartı ve Buton
 *
 * "⚡ AUTO" butonuna basılınca:
 *   1. Veri profili çıkarılır (dataProfiler)
 *   2. Parametre önerileri hesaplanır (autoTune)
 *   3. Öneriler slider'lara uygulanır
 *   4. Şeffaf öneri kartı gösterilir — her ayarın gerekçesiyle
 *   5. Kullanıcı sonrası elle değişiklik yaparsa öğrenme döngüsüne kaydedilir
 *
 * Tamamen bağımsız — silindiğinde hiçbir şey bozulmaz.
 */

import { $ } from "../app/state.js";
import { t } from "../i18n/index.js";
import { logLine } from "./telemetry.js";
import { setStatus } from "../app/status.js";
import {
  buildProfile,
  hashProfile,
} from "../hybrid/dataProfiler.js";
import {
  computeSuggestions,
  applySuggestions,
  recordUserOverride,
  getLearningStats,
} from "../hybrid/autoTune.js";

/* ── Durum ─────────────────────────────────────────────── */

const panelState = {
  lastProfile: null,
  lastKey: "none",
  lastSuggestions: [],
  /** Öğrenme penceresi: AUTO uygulandıkdan sonra kısa süre dinle */
  learningActive: false,
  learningCleanup: null,
};

/** Parametre başlıkları (kartta görünür) */
function paramTitle(id) {
  const map = {
    "csv-pool-size": "Havuz Boyutu",
    "csv-fit": "Sığdırma Payı",
    "csv-point-size": "Nokta Boyutu",
    "csv-slice-count": "Dilim Sayısı",
    "csv-threshold": "Tespit Eşiği",
    "csv-min-strength": "Min Güç",
    "csv-grid-res": "Grid Çözünürlüğü",
    "csv-sigma": "Sigma (σ)",
    "unified-csv-weight": "CSV Desteği",
    "main-sensitivity-slider": "Yapı Hassasiyeti",
  };
  return map[id] || id;
}

/** Değerin görünen formatı (id'ye göre) */
function formatValue(id, v) {
  if (id === "csv-pool-size") return `${v}m`;
  if (id === "csv-fit" || id === "unified-csv-weight") return `%${v}`;
  if (id === "csv-point-size") return Number(v).toFixed(2);
  if (id === "main-sensitivity-slider") return `%${v}`;
  return String(v);
}

/* ── Profili Çıkar + Öner ───────────────────────────────── */

/**
 * AUTO çalıştır: profili çıkar, öneri hesapla, uygula, kartı göster.
 * main.js'den çağrılır (state'e erişim orada).
 *
 * @param {Object} src
 * @param {string|null} src.imageBase64
 * @param {Object|null} src.csvData
 */
export async function runAutoTune({ imageBase64, csvData } = {}) {
  if (!imageBase64 && !csvData) {
    setStatus(t("auto.needData"));
    logLine(t("auto.needData"), "warn");
    return null;
  }

  setStatus(t("auto.profiling"));
  logLine(t("auto.logStart"), "info");

  const profile = await buildProfile({ imageBase64, csvData });
  const key = hashProfile(profile);
  panelState.lastProfile = profile;
  panelState.lastKey = key;

  const suggestions = computeSuggestions(profile, key);
  if (suggestions.length === 0) {
    setStatus(t("auto.noSuggestions"));
    logLine(t("auto.noSuggestions"), "warn");
    showCard(profile, [], key);
    return profile;
  }

  const { applied } = applySuggestions(suggestions);

  // Öğrenme penceresini aç: AUTO sonrası elle değişiklikleri yakala
  startLearningWindow(suggestions);

  showCard(profile, suggestions, key, applied);

  const learned = getLearningStats();
  logLine(t("auto.logDone", { n: applied.length }), "ok");
  setStatus(t("auto.statusDone", { n: applied.length }));
  return profile;
}

/* ── Öğrenme Penceresi ─────────────────────────────────── */

/**
 * AUTO sonrası ~45 sn boyunca slider değişikliklerini dinler;
 * kullanıcı bir parametreyi elle değiştirirse öğrenme döngüsüne kaydeder.
 */
function startLearningWindow(suggestions) {
  stopLearningWindow();

  const autoValues = new Map(suggestions.map((s) => [s.id, s.value]));
  const handlers = [];

  for (const [id] of autoValues) {
    const el = document.getElementById(id);
    if (!el) continue;
    const handler = () => {
      const nv = Number(el.value);
      const av = autoValues.get(id);
      // Sadece gerçekten değiştiyse öğren
      if (Number.isFinite(nv) && Math.abs(nv - av) > 1e-9) {
        recordUserOverride(panelState.lastKey, id, nv);
        logLine(t("auto.logLearned", { param: paramTitle(id), val: formatValue(id, nv) }), "info");
      }
      el.removeEventListener("change", handler);
    };
    el.addEventListener("change", handler);
    handlers.push([el, handler]);
  }

  panelState.learningActive = true;
  const timer = setTimeout(() => stopLearningWindow(), 45_000);
  panelState.learningCleanup = () => {
    clearTimeout(timer);
    for (const [el, handler] of handlers) el.removeEventListener("change", handler);
  };
}

function stopLearningWindow() {
  if (panelState.learningCleanup) {
    panelState.learningCleanup();
    panelState.learningCleanup = null;
  }
  panelState.learningActive = false;
}

/* ── Kart Gösterimi ───────────────────────────────────── */

function showCard(profile, suggestions, key, applied) {
  const host = $("auto-tune-card");
  if (!host) return;

  const img = profile?.image;
  const csv = profile?.csv;
  const srcParts = [];
  if (img) srcParts.push(t("auto.srcImage", { w: img.widthPx, h: img.heightPx }));
  if (csv) srcParts.push(t("auto.srcCsv", { n: csv.pointCount, area: Math.round(csv.areaM2) }));

  const rows = (suggestions || [])
    .map((s) => {
      const isApplied = !applied || applied.some((a) => a.id === s.id);
      const icon = s.learned ? "🧠" : "⚡";
      const tag = s.learned ? t("auto.learnedTag") : t("auto.autoTag");
      return `
        <div class="auto-row ${isApplied ? "" : "is-skipped"}">
          <span class="auto-param">${icon} ${paramTitle(s.id)}</span>
          <span class="auto-reason">${s.reason}</span>
          <span class="auto-value">${tag} <b>${formatValue(s.id, s.value)}</b></span>
        </div>`;
    })
    .join("");

  const learned = getLearningStats();
  const learnedNote = learned.totalOverrides > 0
    ? `<div class="auto-learn-note">🧠 ${t("auto.learnNote", { n: learned.totalOverrides })}</div>`
    : "";

  host.innerHTML = `
    <div class="auto-head">
      <span class="auto-title">⚡ ${t("auto.cardTitle")}</span>
      <button type="button" class="auto-close" id="auto-tune-close" title="${t("auto.close")}">✕</button>
    </div>
    <div class="auto-src">${srcParts.join(" · ")}</div>
    ${rows ? `<div class="auto-rows">${rows}</div>` : `<div class="auto-rows"><div class="auto-row">${t("auto.noSuggestions")}</div></div>`}
    ${learnedNote}
  `;
  host.style.display = "";
  host.dataset.profileKey = key;

  const closeBtn = $("auto-tune-close");
  if (closeBtn) closeBtn.addEventListener("click", hideCard);
}

/** Kartı gizle (i18n yeniden bağlarken çağrılır) */
export function hideCard() {
  const host = $("auto-tune-card");
  if (host) {
    host.style.display = "none";
    host.innerHTML = "";
  }
  stopLearningWindow();
}

/* ── Buton Bağlama ─────────────────────────────────────── */

/**
 * AUTO butonunu bağla — main.js init'te çağırır.
 *
 * @param {() => { imageBase64: string|null, csvData: Object|null }} getSources
 */
export function bindAutoTune(getSources) {
  const btn = $("btn-auto-tune");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await runAutoTune(getSources());
    } finally {
      btn.disabled = false;
    }
  });
}

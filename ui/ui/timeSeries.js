/**
 * timeSeries.js — Zaman Serisi Karşılaştırma.
 *
 * Aynı alanda farklı tarihlerdeki analiz sonuçlarını karşılaştırır.
 * Yeni tespitleri, kaybolanları ve değişmeyenleri gösterir.
 *
 * Kullanım:
 *   import { saveSession, compareSessions, getSessionList } from "./timeSeries.js";
 *
 *   // Mevcut analiz sonucunu kaydet
 *   saveSession('2026-08-15 Çekim');
 *
 *   // İki oturumu karşılaştır
 *   const diff = compareSessions(0, 1);
 */
import { state } from "../app/state.js";
import { logLine } from "./telemetry.js";

// ── Oturum Deposu ──

/** @type {Array<{id: string, label: string, timestamp: number, structures: object, csvData: object|null, gpsRef: object|null}>} */
let sessions = [];

// ── Public API ──

/**
 * Mevcut analiz sonucunu oturum olarak kaydet.
 * @param {string} label - Oturum adı (ör: '2026-08-15 Çekim')
 * @returns {string} Oturum ID'si
 */
export function saveSession(label) {
  const structures = state.csvStructures;
  if (!structures) {
    logLine('Oturum kaydedilecek yapı yok', 'err');
    return null;
  }

  const id = `session_${Date.now()}`;
  const session = {
    id,
    label: label || new Date().toLocaleDateString('tr-TR'),
    timestamp: Date.now(),
    structures: JSON.parse(JSON.stringify(structures)),
    csvData: state.csvData ? {
      bounds: state.csvData.bounds,
      pointCount: state.csvData.pointCount,
      stats: state.csvData.stats,
    } : null,
    gpsRef: state.gpsRef ? { ...state.gpsRef } : null,
  };

  sessions.push(session);

  // Maksimum 10 oturum sakla
  if (sessions.length > 10) {
    sessions.shift();
  }

  console.log(`[TimeSeries] Oturum kaydedildi: ${label} (toplam: ${sessions.length})`);
  logLine(`Oturum kaydedildi: ${label}`, 'ok');
  return id;
}

/**
 * Kayıtlı oturumları listele.
 * @returns {Array<{id, label, timestamp, structureCount}>}
 */
export function getSessionList() {
  return sessions.map(s => ({
    id: s.id,
    label: s.label,
    timestamp: s.timestamp,
    structureCount: countStructures(s.structures),
  }));
}

/**
 * İki oturumu karşılaştır.
 * @param {number} idxA - İlk oturum indeksi
 * @param {number} idxB - İkinci oturum indeksi
 * @returns {object|null} Karşılaştırma sonucu
 */
export function compareSessions(idxA, idxB) {
  if (idxA < 0 || idxA >= sessions.length || idxB < 0 || idxB >= sessions.length) {
    logLine('Geçersiz oturum indeksi', 'err');
    return null;
  }

  const a = sessions[idxA];
  const b = sessions[idxB];

  const result = {
    sessionA: { label: a.label, timestamp: a.timestamp },
    sessionB: { label: b.label, timestamp: b.timestamp },
    chambers: compareList(a.structures.chambers || [], b.structures.chambers || [], 'chamber'),
    tunnels: compareList(a.structures.tunnels || [], b.structures.tunnels || [], 'tunnel'),
    metals: compareList(a.structures.metals || [], b.structures.metals || [], 'metal'),
  };

  // Özet
  result.summary = {
    totalA: countStructures(a.structures),
    totalB: countStructures(b.structures),
    newDetections: result.chambers.new.length + result.tunnels.new.length + result.metals.new.length,
    lostDetections: result.chambers.lost.length + result.tunnels.lost.length + result.metals.lost.length,
    unchanged: result.chambers.unchanged.length + result.tunnels.unchanged.length + result.metals.unchanged.length,
  };

  console.log(`[TimeSeries] Karşılaştırma: ${a.label} vs ${b.label}`);
  console.log(`  Yeni: ${result.summary.newDetections}, Kaybolan: ${result.summary.lostDetections}, Değişmeyen: ${result.summary.unchanged}`);

  return result;
}

/**
 * Bir oturumu sil.
 * @param {number} idx
 */
export function removeSession(idx) {
  if (idx >= 0 && idx < sessions.length) {
    const removed = sessions.splice(idx, 1)[0];
    console.log(`[TimeSeries] Oturum silindi: ${removed.label}`);
  }
}

/**
 * Tüm oturumları temizle.
 */
export function clearSessions() {
  sessions = [];
  console.log('[TimeSeries] Tüm oturumlar temizlendi');
}

/**
 * Karşılaştırma sonucunu HTML olarak formatla.
 * @param {object} diff - compareSessions sonucu
 * @returns {string} HTML
 */
export function formatComparisonHTML(diff) {
  if (!diff) return '<div style="color:var(--muted);">Karşılaştırma yapılamadı</div>';

  const { sessionA, sessionB, summary, chambers, tunnels, metals } = diff;

  let html = `
    <div style="font-size:0.65rem;margin-bottom:0.4rem;">
      <span style="color:#5888e8;">${sessionA.label}</span>
      <span style="color:var(--muted);"> vs </span>
      <span style="color:#e85858;">${sessionB.label}</span>
    </div>
    <div style="display:flex;gap:0.6rem;margin-bottom:0.4rem;font-size:0.62rem;">
      <span style="color:#3edc8c;">+${summary.newDetections} yeni</span>
      <span style="color:#e85858;">-${summary.lostDetections} kaybolan</span>
      <span style="color:var(--muted);">=${summary.unchanged} değişmeyen</span>
    </div>
    <div style="font-size:0.6rem;color:var(--muted);margin-bottom:0.3rem;">
      Toplam: ${summary.totalA} → ${summary.totalB} (${summary.totalB - summary.totalA >= 0 ? '+' : ''}${summary.totalB - summary.totalA})
    </div>`;

  // Detaylı liste
  const allNew = [...chambers.new, ...tunnels.new, ...metals.new];
  const allLost = [...chambers.lost, ...tunnels.lost, ...metals.lost];

  if (allNew.length > 0) {
    html += `<div style="margin-top:0.3rem;font-size:0.6rem;color:#3edc8c;font-weight:600;">Yeni Tespitler:</div>`;
    allNew.forEach(item => {
      html += `<div style="font-size:0.58rem;color:#3edc8c;padding:0.1rem 0;">+ ${item.label} (${(item.strength * 100).toFixed(0)}%)</div>`;
    });
  }

  if (allLost.length > 0) {
    html += `<div style="margin-top:0.3rem;font-size:0.6rem;color:#e85858;font-weight:600;">Kaybolan Tespitler:</div>`;
    allLost.forEach(item => {
      html += `<div style="font-size:0.58rem;color:#e85858;padding:0.1rem 0;">- ${item.label} (${(item.strength * 100).toFixed(0)}%)</div>`;
    });
  }

  if (allNew.length === 0 && allLost.length === 0) {
    html += `<div style="font-size:0.6rem;color:var(--muted);margin-top:0.3rem;">Fark yok — tüm tespitler değişmemiş.</div>`;
  }

  return html;
}

// ── Yardımcılar ──

function countStructures(s) {
  return (s.chambers?.length || 0) + (s.tunnels?.length || 0) + (s.metals?.length || 0);
}

/**
 * İki yapı listesini karşılaştır.
 * Yakın konumlu ve benzer tipteki yapıları "değişmeyen" olarak eşleştir.
 */
function compareList(listA, listB, type) {
  const matched = new Set();
  const unchanged = [];
  const newItems = [];
  const lost = [];

  // listA'deki her öğe için listB'de yakın eş bul
  for (const itemA of listA) {
    const cx = itemA.cx ?? ((itemA.x0 || 0) + (itemA.x1 || 0)) / 2;
    const cy = itemA.cy ?? itemA.y0 ?? 0;
    let bestMatch = null;
    let bestDist = Infinity;

    for (let j = 0; j < listB.length; j++) {
      if (matched.has(j)) continue;
      const itemB = listB[j];
      const bx = itemB.cx ?? ((itemB.x0 || 0) + (itemB.x1 || 0)) / 2;
      const by = itemB.cy ?? itemB.y0 ?? 0;
      const dist = Math.sqrt((cx - bx) ** 2 + (cy - by) ** 2);

      if (dist < bestDist && dist < 5) { // 5 metre eşik
        bestDist = dist;
        bestMatch = j;
      }
    }

    if (bestMatch !== null) {
      matched.add(bestMatch);
      unchanged.push({
        label: formatLabel(type, unchanged.length + 1),
        itemA,
        itemB: listB[bestMatch],
        distance: bestDist,
        strength: listB[bestMatch].strength || itemA.strength,
      });
    } else {
      newItems.push({
        label: formatLabel(type, newItems.length + 1),
        ...itemA,
      });
    }
  }

  // listB'de eşleşmeyenler = kaybolanlar
  for (let j = 0; j < listB.length; j++) {
    if (!matched.has(j)) {
      lost.push({
        label: formatLabel(type, lost.length + 1),
        ...listB[j],
      });
    }
  }

  return { unchanged, new: newItems, lost };
}

function formatLabel(type, idx) {
  const names = { chamber: 'Oda', tunnel: 'Tünel', metal: 'Metal' };
  return `${names[type] || type} #${idx}`;
}

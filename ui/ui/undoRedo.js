/**
 * undoRedo.js — Geri Al / İleri Al sistemi.
 *
 * Genel amaçlı state yığını. Her işlem (hizalama, renk, yapı silme vb.)
 * bir snapshot olarak kaydedilir, geri alınabilir.
 *
 * Kullanım:
 *   import { pushState, undo, redo, canUndo, canRedo } from "./undoRedo.js";
 *
 *   // Bir değişiklik öncesi state'i kaydet
 *   pushState('alignment', { ...state.csvAlignment });
 *
 *   // Geri al
 *   const prev = undo();
 *   if (prev) Object.assign(state.csvAlignment, prev);
 */

// ── Yığın ──
const MAX_HISTORY = 50;

/** @type {Array<{label: string, data: any, timestamp: number}>} */
let undoStack = [];

/** @type {Array<{label: string, data: any, timestamp: number}>} */
let redoStack = [];

// ── Dinleyiciler ──
/** @type {Array<function>} */
let _listeners = [];

/**
 * Durum değişikliğinde çağrılır.
 * @param {function} fn - () => void
 */
export function onHistoryChange(fn) {
  _listeners.push(fn);
}

function notify() {
  _listeners.forEach(fn => {
    try { fn(); } catch (e) { console.warn('[Undo] Listener hatası:', e); }
  });
}

// ── Public API ──

/**
 * Yeni bir state kaydet (undo yığınına ekle).
 * @param {string} label - İşlem adı (ör: 'alignment', 'color', 'delete')
 * @param {any} data - Kaydedilecek veri (deep copy önerilir)
 */
export function pushState(label, data) {
  const entry = {
    label,
    data: structuredClone ? structuredClone(data) : JSON.parse(JSON.stringify(data)),
    timestamp: Date.now(),
  };

  undoStack.push(entry);

  // Yığın taşırsa eskiyi at
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }

  // Yeni işlem yapıldığında redo yığınını temizle
  redoStack = [];

  console.log(`[Undo] Kaydedildi: ${label} (ystack: ${undoStack.length})`);
  notify();
}

/**
 * Son işlemi geri al.
 * @returns {any|null} Geri alınan veri
 */
export function undo() {
  if (undoStack.length === 0) {
    console.log('[Undo] Geri alınacak işlem yok');
    return null;
  }

  const entry = undoStack.pop();
  redoStack.push(entry);

  console.log(`[Undo] Geri alındı: ${entry.label} (kalan: ${undoStack.length}, redo: ${redoStack.length})`);
  notify();
  return entry;
}

/**
 * Son geri alınan işlemi ileri al.
 * @returns {any|null} İleri alınan veri
 */
export function redo() {
  if (redoStack.length === 0) {
    console.log('[Undo] İleri alınacak işlem yok');
    return null;
  }

  const entry = redoStack.pop();
  undoStack.push(entry);

  console.log(`[Undo] İleri alındı: ${entry.label} (ystack: ${undoStack.length}, redo: ${redoStack.length})`);
  notify();
  return entry;
}

/**
 * Geri Alma işlemi var mı?
 * @returns {boolean}
 */
export function canUndo() {
  return undoStack.length > 0;
}

/**
 * İleri Alma işlemi var mı?
 * @returns {boolean}
 */
export function canRedo() {
  return redoStack.length > 0;
}

/**
 * Mevcut yığın durumunu döndür.
 */
export function getHistoryStatus() {
  return {
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    lastUndo: undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null,
    lastRedo: redoStack.length > 0 ? redoStack[redoStack.length - 1].label : null,
  };
}

/**
 * Tüm geçmişi temizle.
 */
export function clearHistory() {
  undoStack = [];
  redoStack = [];
  console.log('[Undo] Geçmiş temizlendi');
  notify();
}

/**
 * Son N işlemi listele (debug için).
 */
export function getRecentHistory(n = 5) {
  const undos = undoStack.slice(-n).map(e => ({ type: 'undo', label: e.label }));
  const redos = redoStack.slice(-n).map(e => ({ type: 'redo', label: e.label }));
  return { undos, redos };
}

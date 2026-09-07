/**
 * sessionManager.js — Oturum Kaydet / Yükle / Yönet.
 *
 * Mevcut analiz durumunu (yüzey, CSV, hizalama, kesit, renk, notlar)
 * JSON dosyası olarak kaydeder, sonra geri yükler.
 *
 * Kullanım:
 *   import { saveSession, loadSession, listSessions } from "./sessionManager.js";
 *   await saveSession("Saha Çekimi #3");
 *   const sessions = listSessions();
 */
import { state } from "../app/state.js";

const STORAGE_KEY = "votex_sessions";
const AUTO_SAVE_KEY = "votex_autosave";
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 dakika

let _autoSaveTimer = null;

// ── Yardımcılar ──

function getAllSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistAll(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn("[Session] Kaydetme hatası:", e);
  }
}

function serializeState() {
  const snap = {
    version: "0.3.13",
    timestamp: new Date().toISOString(),
    name: "",
    // Yüzey verisi
    surfaceState: state.surfaceState ? JSON.parse(JSON.stringify(state.surfaceState)) : null,
    // CSV verisi
    csvData: state.csvData || null,
    csvContent: state.csvContent || null,
    csvFileName: state.csvFileName || null,
    // Hizalama
    csvAlignment: state.csvAlignment
      ? JSON.parse(JSON.stringify(state.csvAlignment))
      : null,
    // Kesit
    clipEnabled: state.clipEnabled,
    clipHeightM: state.clipHeightM,
    // X-Ray
    xray: state.xray,
    // Renk paleti
    colorPalette: state.colorPalette || "none",
    // Tespit notları
    detectionNotes: state.detectionNotes
      ? JSON.parse(JSON.stringify(state.detectionNotes))
      : {},
    // Very verisi
    pendingFile: state.pendingFile
      ? { name: state.pendingFile.name, base64: state.pendingFile.base64 }
      : null,
  };
  return snap;
}

function deserializeState(snap) {
  if (!snap) return;

  if (snap.surfaceState) state.surfaceState = snap.surfaceState;
  if (snap.csvData) state.csvData = snap.csvData;
  if (snap.csvContent) state.csvContent = snap.csvContent;
  if (snap.csvFileName) state.csvFileName = snap.csvFileName;
  if (snap.csvAlignment) state.csvAlignment = snap.csvAlignment;
  if (snap.detectionNotes) state.detectionNotes = snap.detectionNotes;
  if (snap.pendingFile) state.pendingFile = snap.pendingFile;

  state.clipEnabled = !!snap.clipEnabled;
  state.clipHeightM = snap.clipHeightM ?? 3;
  state.xray = !!snap.xray;
  state.colorPalette = snap.colorPalette || "none";
}

// ── Public API ──

/**
 * Mevcut durumu kaydet.
 * @param {string} name — Oturum adı (opsiyonel)
 * @returns {object} Kaydedilen oturum
 */
export function saveSession(name) {
  const snap = serializeState();
  snap.name = name || `Oturum ${new Date().toLocaleString("tr-TR")}`;
  snap.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const sessions = getAllSessions();
  sessions.unshift(snap); // en yenisi başta
  // Maksimum 20 oturum
  if (sessions.length > 20) sessions.length = 20;
  persistAll(sessions);

  return snap;
}

/**
 * Kayıtlı oturumu yükle.
 * @param {string} id — Oturum ID'si
 * @returns {boolean} Başarılı mı
 */
export function loadSession(id) {
  const sessions = getAllSessions();
  const snap = sessions.find((s) => s.id === id);
  if (!snap) return false;

  deserializeState(snap);
  return true;
}

/**
 * Tüm kayıtlı oturumları listele.
 * @returns {Array<object>}
 */
export function listSessions() {
  return getAllSessions().map((s) => ({
    id: s.id,
    name: s.name,
    timestamp: s.timestamp,
    csvFileName: s.csvFileName,
    hasSurface: !!s.surfaceState,
    hasCsv: !!s.csvData,
  }));
}

/**
 * Oturumu sil.
 * @param {string} id
 */
export function deleteSession(id) {
  const sessions = getAllSessions().filter((s) => s.id !== id);
  persistAll(sessions);
}

/**
 * Tüm oturumları temizle.
 */
export function clearAllSessions() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Anlık kaydetme (mevcut durumu geri yüklemek için).
 */
export function autoSave() {
  const snap = serializeState();
  snap.name = "Otomatik Kayıt";
  snap.id = "__autosave__";
  try {
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(snap));
  } catch {}
}

/**
 * Otomatik kaydı yükle (varsa).
 * @returns {boolean}
 */
export function loadAutoSave() {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    deserializeState(snap);
    return true;
  } catch {
    return false;
  }
}

/**
 * Otomatik kaydetme döngüsünü başlat.
 */
export function startAutoSave() {
  stopAutoSave();
  _autoSaveTimer = setInterval(autoSave, AUTO_SAVE_INTERVAL_MS);
}

/**
 * Otomatik kaydetme döngüsünü durdur.
 */
export function stopAutoSave() {
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer);
    _autoSaveTimer = null;
  }
}

/**
 * Mevcut oturum durumunu dışa aktar (JSON dosyası).
 * @returns {string} JSON string
 */
export function exportSessionJson() {
  const snap = serializeState();
  snap.name = snap.name || "Dışa Aktarılan Oturum";
  return JSON.stringify(snap, null, 2);
}

/**
 * JSON dosyasından oturum yükle.
 * @param {string} jsonString
 * @returns {boolean}
 */
export function importSessionJson(jsonString) {
  try {
    const snap = JSON.parse(jsonString);
    if (!snap.timestamp) return false;
    deserializeState(snap);
    return true;
  } catch {
    return false;
  }
}

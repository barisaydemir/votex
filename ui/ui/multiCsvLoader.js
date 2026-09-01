/**
 * multiCsvLoader.js — Toplu CSV Yükleme & Yönetim
 *
 * Birden fazla CSV dosyasını aynı anda yükler:
 *   1. Her dosyayı ayrı ayrı parse eder (Rust backend)
 *   2. Noktaları birleştirir veya ayrı tutar (dataset seçimiyle)
 *   3. Tüm verileri tek 3D sahneye yerleştirir
 *   4. Dosya listesinde renkli etiketlerle gösterir
 *
 * Kullanım:
 *   import { initMultiCsv, addFiles, getDatasets, getMergedData, removeDataset } from "./multiCsvLoader.js";
 *   initMultiCsv();
 */

import { $, state } from "../app/state.js";

// ── Durum ──
let _datasets = [];          // [{id, name, color, csvData, csvContent, fileName, visible, pointCount}]
let _nextId = 1;
let _selectedId = null;       // Aktif seçili dataset (null = birleşik mod)
let _mergeMode = "overlay";   // "overlay" (hepsini birleştir) veya "separate" (ayrı ayrı)

// Dataset renkleri (döngüsel)
const DATASET_COLORS = [
  "#3edc8c", "#e85858", "#7eb6ff", "#ffd27a", "#c084fc",
  "#4ec0d4", "#f97316", "#a3e635", "#f472b6", "#38bdf8",
];

// ── API import ──
let _invoke = null;
async function invoke(cmd, args) {
  if (!_invoke) {
    try {
      const mod = await import("@tauri-apps/api/core");
      _invoke = mod.invoke;
    } catch {
      _invoke = () => Promise.reject(new Error("Tauri API not available"));
    }
  }
  return _invoke(cmd, args);
}

// ── Başlatma ──

/**
 * Multi-CSV modülünü başlatır — state'e başlangıç değerlerini atar.
 */
export function initMultiCsv() {
  if (!state.multiCsv) {
    state.multiCsv = {
      datasets: _datasets,
      selectedId: null,
      mergeMode: "overlay",
    };
  }
  console.log("[MultiCSV] Başlatıldı");
}

/**
 * Dışarıdan bir dosya ekler (file input veya drop).
 * @param {File} file
 * @returns {Promise<Object|null>} Parse sonucu
 */
export async function addFile(file) {
  const name = file.name || `Dataset ${_nextId}`;
  const content = await readFileText(file);
  if (!content) return null;

  return await addCsvContent(content, name, name);
}

/**
 * Ham CSV içeriğiyle dataset ekler.
 * @param {string} content — CSV metni
 * @param {string} name — Dataset adı (dosya adı gibi)
 * @param {string} [fileName] — Orijinal dosya adı
 * @returns {Promise<Object>} Dataset nesnesi
 */
export async function addCsvContent(content, name, fileName) {
  const id = `csv-${_nextId++}`;
  const color = DATASET_COLORS[(_datasets.length) % DATASET_COLORS.length];

  // Rust backend ile parse et
  let csvData = null;
  try {
    csvData = await invoke("analyze_csv_data", {
      csvContent: content,
      fileName: fileName || name,
      viewMode: "yan",
    });
  } catch (e) {
    console.warn(`[MultiCSV] Parse hatası (${name}):`, e.message || e);
    // Fallback: basit parse
    csvData = simpleParseCsv(content);
  }

  const dataset = {
    id,
    name,
    color,
    csvData,
    csvContent: content,
    fileName: fileName || name,
    visible: true,
    pointCount: csvData?.pointCount || csvData?.points?.length || 0,
    addedAt: Date.now(),
  };

  _datasets.push(dataset);
  _selectedId = id; // Son ekleneni seç

  // State'i güncelle
  syncState();

  console.log(`[MultiCSV] Eklendi: ${name} (${dataset.pointCount} nokta, renk: ${color})`);
  return dataset;
}

/**
 * Birden fazla dosyayı toplu ekler.
 * @param {FileList|File[]} files
 * @returns {Promise<Object[]>} Eklenen dataset'ler
 */
export async function addFiles(files) {
  const results = [];
  for (const file of files) {
    const ds = await addFile(file);
    if (ds) results.push(ds);
  }
  return results;
}

/**
 * Dataset'i kaldırır.
 * @param {string} id
 */
export function removeDataset(id) {
  const idx = _datasets.findIndex(d => d.id === id);
  if (idx === -1) return;
  _datasets.splice(idx, 1);
  if (_selectedId === id) {
    _selectedId = _datasets.length > 0 ? _datasets[_datasets.length - 1].id : null;
  }
  syncState();
  console.log(`[MultiCSV] Kaldırıldı: ${id}`);
}

/**
 * Tüm dataset'leri temizler.
 */
export function clearAll() {
  _datasets.length = 0;
  _selectedId = null;
  syncState();
  console.log("[MultiCSV] Tümü temizlendi");
}

/**
 * Dataset görünürlüğünü değiştirir.
 * @param {string} id
 * @param {boolean} visible
 */
export function setDatasetVisible(id, visible) {
  const ds = _datasets.find(d => d.id === id);
  if (ds) {
    ds.visible = visible;
    syncState();
  }
}

/**
 * Dataset'i seçer (detaylı görüntüleme için).
 * @param {string|null} id — null = birleşik mod
 */
export function selectDataset(id) {
  _selectedId = id;
  syncState();
}

/**
 * Birleştirme modunu değiştirir.
 * @param {"overlay"|"separate"} mode
 */
export function setMergeMode(mode) {
  _mergeMode = mode;
  syncState();
}

/**
 * Tüm dataset'lerin birleştirilmiş CSV verisini döndürür.
 * Görünmeyen dataset'ler hariç tutulur.
 * @returns {Object|null} { points, pointCount, xMin, xMax, yMin, yMax, zMin, zMax, magneticMin, magneticMax }
 */
export function getMergedData() {
  const visible = _datasets.filter(d => d.visible && d.csvData);
  if (visible.length === 0) return null;

  if (visible.length === 1) return visible[0].csvData;

  // Tüm noktaları birleştir
  let allPoints = [];
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  let magneticMin = Infinity, magneticMax = -Infinity;

  for (const ds of visible) {
    const pts = ds.csvData?.points || [];
    for (const p of pts) {
      allPoints.push({ ...p, _datasetId: ds.id, _datasetColor: ds.color });
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
      const m = p.magnetic ?? 0;
      if (m < magneticMin) magneticMin = m;
      if (m > magneticMax) magneticMax = m;
    }
  }

  if (allPoints.length === 0) return null;

  return {
    points: allPoints,
    pointCount: allPoints.length,
    xMin, xMax, yMin, yMax, zMin, zMax,
    magneticMin, magneticMax,
  };
}

/**
 * Seçili dataset'i döndürür (veya birleşik modda ilkini).
 * @returns {Object|null}
 */
export function getSelectedData() {
  if (_selectedId) {
    const ds = _datasets.find(d => d.id === _selectedId);
    if (ds) return ds.csvData;
  }
  return getMergedData();
}

/**
 * Tüm dataset listesini döndürür.
 * @returns {Object[]}
 */
export function getDatasets() {
  return [..._datasets];
}

/**
 * Dataset sayısını döndürür.
 * @returns {number}
 */
export function getDatasetCount() {
  return _datasets.length;
}

/**
 * Birleşik modda mıyız?
 * @returns {boolean}
 */
export function isMergeMode() {
  return _mergeMode === "overlay";
}

// ── Yardımcı Fonksiyonlar ──

/**
 * Dosya içeriğini text olarak okur.
 */
function readFileText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => {
      console.error(`[MultiCSV] Dosya okuma hatası: ${file.name}`);
      resolve(null);
    };
    reader.readAsText(file);
  });
}

/**
 * Basit CSV parse (Rust backend olmadığında fallback).
 * x,y,z,magnetic formatını destekler.
 */
function simpleParseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  // Header'ı atla (sayısal başlangıçlı değilse)
  let startIdx = 0;
  const firstLine = lines[0].split(/[,;\t]/).map(s => s.trim());
  if (firstLine.some(h => isNaN(Number(h)))) startIdx = 1;

  const points = [];
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  let mMin = Infinity, mMax = -Infinity;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(/[,;\t]/).map(s => s.trim());
    if (cols.length < 3) continue;
    const x = Number(cols[0]);
    const y = Number(cols[1]);
    const z = Number(cols[2]);
    const magnetic = cols.length >= 4 ? Number(cols[3]) : 0;
    if ([x, y, z].some(v => !Number.isFinite(v))) continue;

    points.push({ x, y, z, magnetic });
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    if (magnetic < mMin) mMin = magnetic; if (magnetic > mMax) mMax = magnetic;
  }

  if (points.length === 0) return null;

  return {
    points,
    pointCount: points.length,
    xMin, xMax, yMin, yMax, zMin, zMax,
    magneticMin: mMin, magneticMax: mMax,
  };
}

/**
 * State'i dataset listesiyle senkronize eder.
 */
function syncState() {
  if (state.multiCsv) {
    state.multiCsv.datasets = _datasets;
    state.multiCsv.selectedId = _selectedId;
    state.multiCsv.mergeMode = _mergeMode;
  }
}

/**
 * batchDta.js — Toplu DTA işleme.
 *
 * Aynı anda birden fazla DTA dosyasını yükler, her birini ayrı ayrı işler
 * ve sonuçları karşılaştırmalı olarak sunar.
 *
 * Kullanım:
 *   import { initBatchDta, processBatch } from "./batchDta.js";
 *   initBatchDta();
 */
import { state } from "../app/state.js";

/** Toplu DTA durumu */
export const batchState = {
  files: [],          // [{ name, blob, result?, status }]
  processing: false,
  progress: 0,
  total: 0,
};

/**
 * Toplu DTA UI'ını initialize et.
 */
export function initBatchDta() {
  const container = document.getElementById("batch-dta-content");
  if (!container) return;

  renderBatchUI(container);
}

function renderBatchUI(container) {
  container.innerHTML = `
    <div style="font-size:0.65rem;color:var(--muted);margin-bottom:0.5rem;">
      Birden fazla DTA dosyasını aynı anda yükleyip karşılaştırın.
    </div>

    <button id="batch-dta-pick" style="width:100%;padding:5px 8px;background:#7c3aed;color:#fff;border:none;border-radius:4px;font-size:0.62rem;cursor:pointer;margin-bottom:0.4rem;">
      📁 TOPLU DTA SEÇ
    </button>

    <div id="batch-dta-dropzone"
      style="border:2px dashed var(--line);border-radius:6px;padding:0.8rem;text-align:center;font-size:0.6rem;color:var(--muted);margin-bottom:0.4rem;cursor:pointer;transition:border-color 0.2s;">
      DTA dosyalarını buraya sürükleyin
    </div>

    <div id="batch-dta-list" style="max-height:200px;overflow-y:auto;"></div>

    <div style="display:flex;gap:0.3rem;margin-top:0.4rem;">
      <button id="batch-dta-process" style="flex:1;padding:4px 8px;background:#22c55e;color:#000;border:none;border-radius:4px;font-size:0.62rem;cursor:pointer;"
        disabled>▶ İŞLE</button>
      <button id="batch-dta-clear" style="flex:1;padding:4px 8px;background:var(--bg2);color:var(--muted);border:1px solid var(--line);border-radius:4px;font-size:0.62rem;cursor:pointer;">
        ✕ TEMİZLE</button>
    </div>

    <div id="batch-dta-progress" style="margin-top:0.3rem;"></div>
  `;

  // Event binding
  const pickBtn = container.querySelector("#batch-dta-pick");
  const dropzone = container.querySelector("#batch-dta-dropzone");
  const processBtn = container.querySelector("#batch-dta-process");
  const clearBtn = container.querySelector("#batch-dta-clear");

  pickBtn?.addEventListener("click", openFilePicker);
  dropzone?.addEventListener("click", openFilePicker);

  // Drag & drop
  dropzone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "#7c3aed";
  });
  dropzone?.addEventListener("dragleave", () => {
    dropzone.style.borderColor = "var(--line)";
  });
  dropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "var(--line)";
    handleDtaFiles(e.dataTransfer.files);
  });

  processBtn?.addEventListener("click", processBatch);
  clearBtn?.addEventListener("click", clearBatch);

  renderFileList();
}

function openFilePicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".dta,.DDT,.txt,.csv";
  input.multiple = true;
  input.onchange = (e) => handleDtaFiles(e.target.files);
  input.click();
}

function handleDtaFiles(fileList) {
  for (const file of fileList) {
    // Aynı dosya tekrar eklenmesin
    if (batchState.files.some((f) => f.name === file.name)) continue;

    batchState.files.push({
      name: file.name,
      blob: file,
      size: file.size,
      result: null,
      status: "beklemede", // beklemede | işleniyor | tamamlandı | hata
      error: null,
    });
  }

  renderFileList();
  updateProcessButton();
}

function renderFileList() {
  const list = document.getElementById("batch-dta-list");
  if (!list) return;

  if (!batchState.files.length) {
    list.innerHTML = '<div style="font-size:0.58rem;color:var(--muted);text-align:center;padding:0.5rem;">Dosya seçilmedi</div>';
    return;
  }

  list.innerHTML = batchState.files.map((f, i) => {
    const statusEmoji = f.status === "tamamlandı" ? "✅" : f.status === "hata" ? "❌" : f.status === "işleniyor" ? "⏳" : "⏸";
    const sizeKB = Math.round((f.size || 0) / 1024);
    return `
      <div style="display:flex;align-items:center;gap:0.3rem;padding:0.2rem 0.3rem;border-bottom:1px solid var(--line);font-size:0.58rem;">
        <span>${statusEmoji}</span>
        <span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.name}">${f.name}</span>
        <span style="color:var(--muted);font-size:0.52rem;">${sizeKB}KB</span>
        <button class="batch-remove" data-idx="${i}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.6rem;padding:0 2px;" title="Kaldır">✕</button>
      </div>
    `;
  }).join("");

  // Remove button bindings
  list.querySelectorAll(".batch-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      batchState.files.splice(idx, 1);
      renderFileList();
      updateProcessButton();
    });
  });
}

function updateProcessButton() {
  const btn = document.getElementById("batch-dta-process");
  if (btn) {
    btn.disabled = batchState.files.length === 0 || batchState.processing;
  }
}

function clearBatch() {
  batchState.files = [];
  batchState.processing = false;
  batchState.progress = 0;
  batchState.total = 0;
  renderFileList();
  updateProcessButton();

  const progress = document.getElementById("batch-dta-progress");
  if (progress) progress.innerHTML = "";
}

/**
 * Toplu DTA işleme.
 * Gerçek DTA okuma Tauri IPC gerektirir — burada dosya bilgilerini topluyoruz.
 */
async function processBatch() {
  if (batchState.processing || !batchState.files.length) return;

  batchState.processing = true;
  batchState.total = batchState.files.length;
  batchState.progress = 0;
  updateProcessButton();

  for (let i = 0; i < batchState.files.length; i++) {
    const f = batchState.files[i];
    f.status = "işleniyor";
    renderFileList();
    updateProgress(i + 1, batchState.total, f.name);

    try {
      // DTA dosyasını oku (ilk 1KB header bilgisi)
      const header = await readDtaHeader(f.blob);

      f.result = {
        format: header.format || "bilinmiyor",
        fieldCount: header.fieldCount || 0,
        lineCount: header.lineCount || 0,
        encoding: header.encoding || "utf-8",
        decimalSep: header.decimalSep || ".",
      };
      f.status = "tamamlandı";
    } catch (err) {
      f.error = err.message;
      f.status = "hata";
    }

    renderFileList();
  }

  batchState.processing = false;
  updateProcessButton();
  renderBatchResults();
}

/**
 * DTA dosyasının header bilgisini oku.
 */
async function readDtaHeader(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());

      // Format tespiti
      let format = "bilinmiyor";
      if (lines[0]?.includes("#")) format = "YAML-like";
      else if (lines[0]?.includes(";")) format = "SDC/CSV (;)";
      else if (lines[0]?.includes(",")) format = "CSV (,)";
      else if (lines[0]?.includes("\t")) format = "TSV";

      // Ondalık ayracı tespiti
      const sampleLine = lines.find((l) => /\d[.,]\d/.test(l)) || "";
      const commaDecimals = (sampleLine.match(/,\d{2,}/g) || []).length;
      const dotDecimals = (sampleLine.match(/\.\d{2,}/g) || []).length;
      const decimalSep = commaDecimals > dotDecimals ? "," : ".";

      // Alan sayısı
      const dataLine = lines.find((l) => !l.startsWith("#") && !l.startsWith(" ")) || "";
      const delimiter = format.includes(";") ? ";" : format.includes("\t") ? "\t" : ",";
      const fieldCount = dataLine.split(delimiter).length;

      resolve({
        format,
        fieldCount,
        lineCount: lines.length,
        encoding: "utf-8",
        decimalSep,
      });
    };
    reader.onerror = () => reject(new Error("Dosya okunamadı"));
    reader.readAsText(blob, "utf-8");
  });
}

function updateProgress(current, total, fileName) {
  const el = document.getElementById("batch-dta-progress");
  if (!el) return;

  const pct = Math.round((current / total) * 100);
  el.innerHTML = `
    <div style="background:var(--bg2);border-radius:4px;overflow:hidden;height:16px;position:relative;">
      <div style="background:#7c3aed;height:100%;width:${pct}%;transition:width 0.3s;"></div>
      <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:0.55rem;color:#fff;font-weight:600;">
        ${current}/${total} — ${fileName}
      </span>
    </div>
  `;
}

function renderBatchResults() {
  const progress = document.getElementById("batch-dta-progress");
  if (!progress) return;

  const completed = batchState.files.filter((f) => f.status === "tamamlandı");
  const errors = batchState.files.filter((f) => f.status === "hata");

  let html = `<div style="font-size:0.6rem;color:var(--text);margin-bottom:0.3rem;">📊 Sonuçlar: ${completed.length} başarılı, ${errors.length} hata</div>`;

  for (const f of completed) {
    const r = f.result;
    html += `
      <div style="background:var(--bg2);border:1px solid var(--line);border-radius:4px;padding:0.3rem;margin-bottom:0.2rem;font-size:0.55rem;">
        <div style="color:var(--text);font-weight:600;">${f.name}</div>
        <div style="color:var(--muted);">
          Format: ${r.format} · Alan: ${r.fieldCount} · Satır: ${r.lineCount} · Ondalık: "${r.decimalSep}"
        </div>
      </div>
    `;
  }

  for (const f of errors) {
    html += `
      <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:4px;padding:0.3rem;margin-bottom:0.2rem;font-size:0.55rem;">
        <div style="color:#ef4444;font-weight:600;">❌ ${f.name}</div>
        <div style="color:var(--muted);">${f.error}</div>
      </div>
    `;
  }

  progress.innerHTML = html;
}

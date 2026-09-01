/**
 * unifiedPanel.js — Tek Butonlu Hibrit Panel
 *
 * Tek "BAŞLAT" butonu ile tüm analiz:
 *   1. Image yükle (birincil)
 *   2. CSV destek (opsiyonel)
 *   3. Tek 3D sahne oluştur
 */

import { $, state } from '../app/state.js';
import { loadImageFromFile } from './imageProcessor.js';
import { runUnifiedAnalysis, createUnified2DMap } from './unifiedAnalysis.js';
import { CoordinateAligner, drawControlPoints } from './coordinateAlignment.js';
import { initClickToAlign, getPoints, getQuality, clearPoints, toggleGrid, destroy as destroyClickAlign } from './clickToAlign.js';

// ── Durum ──

const panelState = {
  image: null,
  csvLoaded: false,
  analyzing: false,
};

// ── Hizalama Durumu ──
let clickAlignActive = false;

// ── Image Yükleme ──

async function handleImagePick() {
  const input = document.getElementById('unified-image-input');
  if (!input) return;

  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const img = await loadImageFromFile(file);
      panelState.image = img;

      // Durum güncelle
      const status = document.getElementById('unified-image-status');
      if (status) {
        status.textContent = `${img.width}×${img.height} piksel`;
        status.style.color = '#3edc8c';
      }

      // Önizleme göster
      const preview = document.getElementById('unified-preview');
      if (preview) preview.style.display = '';

      // Image canvas'a çiz
      const canvas = document.getElementById('unified-image-canvas');
      if (canvas) {
        canvas.width = Math.min(300, img.width);
        canvas.height = Math.min(150, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }

      // Butonu kontrol et
      updateStartButton();

      console.log(`[UnifiedPanel] Image yüklendi: ${img.width}×${img.height}`);
    } catch (err) {
      console.error('[UnifiedPanel] Image hatası:', err);
      const status = document.getElementById('unified-image-status');
      if (status) {
        status.textContent = 'Hata: ' + err.message;
        status.style.color = '#ff6a4a';
      }
    }
  };

  input.click();
}

// ── CSV Durumu ──

function checkCsvStatus() {
  // Panel görünmüyorken periyodik kontrol boşa çalışmasın
  const panel = document.getElementById('unified-panel');
  if (!panel || panel.offsetParent === null) return false;

  const csvData = state.csvData;
  if (csvData && csvData.points && csvData.points.length > 0) {
    panelState.csvLoaded = true;

    const status = document.getElementById('unified-csv-status');
    if (status) {
      status.textContent = `${csvData.pointCount} nokta`;
      status.style.color = '#3edc8c';
    }

    updateStartButton();
    return true;
  }
  return false;
}

// ── Buton Durumu ──

function updateStartButton() {
  const btn = document.getElementById('btn-unified-start');
  if (!btn) return;

  if (panelState.image && panelState.csvLoaded) {
    btn.disabled = false;
    btn.textContent = '🚀 BAŞLAT (Image + CSV)';
  } else if (panelState.image) {
    btn.disabled = false;
    btn.textContent = '🚀 BAŞLAT (Sadece Image)';
  } else {
    btn.disabled = true;
    btn.textContent = '📷 Image Gerekli';
  }
}

// ── Tek Başlatma ──

async function handleStart() {
  if (!panelState.image || panelState.analyzing) return;

  const btn = document.getElementById('btn-unified-start');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analiz...'; panelState.analyzing = true; }

  try {
    // Parametreleri topla
    const csvPoints = state.csvData?.points || [];
    const csvStructures = state.csvStructures || null;

    // Çapraz doğrulama eşiklerini oku
    const cvThresholds = {
      matchDistance: Number(document.getElementById('cv-match-dist')?.value) || 3,
      depthDiff: Number(document.getElementById('cv-depth-diff')?.value) || 2,
      magneticDiff: Number(document.getElementById('cv-magnetic-diff')?.value) || 150,
    };

    const options = {
      csvWeight: Number(document.getElementById('unified-csv-weight')?.value) || 70,
      soilType: document.querySelector('input[name="soil-profile"]')?.value || 'loam',
      poolSizeM: Number(document.getElementById('csv-pool-size')?.value) || 30,
      gridRes: 64,
      ntRange: 500,
      scene: state.scene,
      showHints: true,
      cvThresholds,
      manualAligner: state.manualAligner || null,
    };

    // Tek analiz
    const result = await runUnifiedAnalysis({
      image: panelState.image,
      csvPoints,
      csvStructures,
      options,
    });

    // Sonuçları göster
    showResults(result);

    // Renk-bazlı analiz için orijinal sonucu sakla
    try {
      const { saveOriginalResult, setAnalysisFunction } = await import('../hybrid/colorBasedAnalysis.js');
      saveOriginalResult(result);
      // Analiz fonksiyonunu kaydet (renk değişince tekrar çalıştırılacak)
      setAnalysisFunction(async (_paletteKey) => {
        return await runUnifiedAnalysis({
          image: panelState.image,
          csvPoints,
          csvStructures,
          options,
        });
      });
    } catch (e) {
      console.warn('[UnifiedPanel] colorBasedAnalysis hook hatası:', e);
    }

    console.log(`[UnifiedPanel] Tamamlandı (${result.elapsed}ms)`);
  } catch (err) {
    console.error('[UnifiedPanel] Analiz hatası:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 BAŞLAT'; panelState.analyzing = false; }
  }
}

// ── Sonuçları Göster ──

function showResults(result) {
  const resultsEl = document.getElementById('unified-results');
  if (!resultsEl) return;

  // 2D harita
  const mapCanvas = document.getElementById('unified-map-canvas');
  if (mapCanvas) {
    const drawn = createUnified2DMap(result.imageGrid, state.csvData?.points || [], 300, 150, 500);
    const ctx = mapCanvas.getContext('2d');
    mapCanvas.width = 300;
    mapCanvas.height = 150;
    ctx.clearRect(0, 0, 300, 150);
    ctx.drawImage(drawn, 0, 0);
  }

  // İstatistikler
  const statsEl = document.getElementById('unified-stats');
  if (statsEl) {
    const s = result.imageStats;
    const d = result.depthResult?.stats;
    const h = result.hints?.length || 0;
    const st = result.structures?.length || 0;

    statsEl.innerHTML = `
      <div class="us-row"><span class="us-label">Image</span><span class="us-value">${s.filledCells} hücre, ${(s.matchRate * 100).toFixed(0)}% eşleşme</span></div>
      <div class="us-row"><span class="us-label">Derinlik</span><span class="us-value">${d?.depthMin?.toFixed(1) || 0}..${d?.depthMax?.toFixed(1) || 0}m, ort ${d?.avgDepth?.toFixed(1) || 0}m</span></div>
      <div class="us-row"><span class="us-label">Yapılar</span><span class="us-value">${st} tespit</span></div>
      <div class="us-row"><span class="us-label">İpuçları</span><span class="us-value">${h} (3D'de gösteriliyor)</span></div>
      <div class="us-row"><span class="us-label">Süre</span><span class="us-value">${result.elapsed}ms</span></div>
    `;
  }

  // Çapraz doğrulama raporu
  const cvEl = document.getElementById('unified-cv-report');
  if (cvEl && result.crossValResult) {
    const cv = result.crossValResult;
    const s = cv.stats;
    if (s && s.totalPairs > 0) {
      cvEl.style.display = '';
      cvEl.innerHTML = `
        <div style="font-size:0.68rem;font-weight:600;color:var(--muted);letter-spacing:0.04em;margin-bottom:0.4rem;">🎯 ÇAPRAZ DOĞRULAMA</div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;font-size:0.68rem;">
          <span style="color:#3edc8c;">✓ ${s.matchedCount} uyumlu</span>
          <span style="color:#eab308;">✗ ${s.mismatchedCount} uyumsuz</span>
          <span style="color:#8ea8b8;">📷 ${s.unmatchedImageCount} sadece image</span>
          <span style="color:#8ea8b8;">📊 ${s.unmatchedCsvCount} sadece csv</span>
        </div>
        <div style="margin-top:0.3rem;font-size:0.68rem;">
          <span style="color:var(--muted);">Uyum:</span>
          <span style="color:${s.agreementRate > 0.7 ? '#3edc8c' : s.agreementRate > 0.4 ? '#eab308' : '#f97316'};font-weight:600;">${(s.agreementRate * 100).toFixed(0)}%</span>
          <span style="color:var(--muted);margin-left:0.5rem;">Güven:</span>
          <span style="color:${s.overallConfidence > 0.7 ? '#3edc8c' : s.overallConfidence > 0.4 ? '#eab308' : '#f97316'};font-weight:600;">${(s.overallConfidence * 100).toFixed(0)}%</span>
          ${s.matchedCount > 0 ? `<span style="color:var(--muted);margin-left:0.5rem;">Ort. derinlik farkı:</span> <span style="color:#8ea8b8;">${s.avgDepthDiff.toFixed(1)}m</span>` : ''}
        </div>
      `;
    } else {
      cvEl.style.display = '';
      cvEl.innerHTML = '<div style="font-size:0.68rem;color:var(--muted);">🎯 Çapraz doğrulama: yeterli veri yok (image + CSV gerekli)</div>';
    }
  }

  resultsEl.style.display = '';
}

// ── Eşik Slider Bağlantıları ──

function bindThresholdSliders() {
  const sliders = [
    { id: 'cv-match-dist', label: 'cv-match-dist-label', unit: 'm' },
    { id: 'cv-depth-diff', label: 'cv-depth-diff-label', unit: 'm' },
    { id: 'cv-magnetic-diff', label: 'cv-magnetic-diff-label', unit: 'nT' },
  ];

  for (const s of sliders) {
    const slider = document.getElementById(s.id);
    const label = document.getElementById(s.label);
    if (slider && label) {
      slider.addEventListener('input', () => {
        label.textContent = slider.value + s.unit;
      });
    }
  }

  // Info metnini güncelle
  updateThresholdInfo();
  for (const s of sliders) {
    const slider = document.getElementById(s.id);
    if (slider) slider.addEventListener('input', updateThresholdInfo);
  }
}

function updateThresholdInfo() {
  const dist = Number(document.getElementById('cv-match-dist')?.value) || 3;
  const depth = Number(document.getElementById('cv-depth-diff')?.value) || 2;
  const mag = Number(document.getElementById('cv-magnetic-diff')?.value) || 150;
  const infoEl = document.getElementById('cv-threshold-info');
  if (infoEl) {
    const strictness = dist <= 2 && depth <= 1.5 && mag <= 100
      ? '🔴 Katı' : dist >= 5 && depth >= 3 && mag >= 300
        ? '🟢 Gevşek' : '🟡 Dengeli';
    infoEl.textContent = `${strictness} — ${dist}m mesafe, ${depth}m derinlik, ${mag}nT manyetik`;
  }
}

// ── Interaktif Click-to-Align ──

function bindClickToAlign() {
  const canvas = document.getElementById('unified-image-canvas');
  if (!canvas || clickAlignActive) return;
  clickAlignActive = true;

  // clickToAlign modülünü başlat
  initClickToAlign(canvas, panelState.image, {
    onApply: (aligner) => {
      state.manualAligner = aligner;
      updateAlignQualityUI();
    },
    onClear: () => {
      state.manualAligner = null;
      const qualityEl = document.getElementById('manual-align-quality');
      if (qualityEl) qualityEl.style.display = 'none';
    },
  });

  // Butonları bağla
  document.getElementById('btn-manual-align-apply')?.addEventListener('click', () => {
    const aligner = getPoints().length >= 2 ? state.manualAligner : null;
    if (aligner) updateAlignQualityUI();
  });

  document.getElementById('btn-manual-align-clear')?.addEventListener('click', () => {
    clearPoints();
    state.manualAligner = null;
    const qualityEl = document.getElementById('manual-align-quality');
    if (qualityEl) qualityEl.style.display = 'none';
  });

  // Grid toggle butonu ekle
  const ctrlWrap = document.getElementById('manual-align-points')?.parentElement;
  if (ctrlWrap && !ctrlWrap.querySelector('#btn-align-grid')) {
    const gridBtn = document.createElement('button');
    gridBtn.id = 'btn-align-grid';
    gridBtn.type = 'button';
    gridBtn.className = 'mil';
    gridBtn.textContent = '⊞ Izgara';
    gridBtn.style.cssText = 'font-size:0.62rem;padding:3px 8px;';
    let gridVisible = false;
    gridBtn.addEventListener('click', () => {
      gridVisible = !gridVisible;
      toggleGrid(gridVisible);
      gridBtn.style.borderColor = gridVisible ? '#3edc8c' : '';
      gridBtn.style.color = gridVisible ? '#3edc8c' : '';
    });
    ctrlWrap.appendChild(gridBtn);
  }
}

function updateAlignQualityUI() {
  const quality = getQuality();
  const qualityEl = document.getElementById('manual-align-quality');
  if (!qualityEl) return;

  if (!quality || getPoints().length < 2) {
    qualityEl.style.display = 'none';
    return;
  }

  qualityEl.style.display = '';
  const scoreColor = quality.score >= 70 ? '#3edc8c' : quality.score >= 40 ? '#eab308' : '#f97316';
  const pts = getPoints();
  qualityEl.innerHTML = `
    <div style="padding:0.3rem;background:rgba(255,255,255,0.02);border-radius:4px;border:1px solid var(--line);">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:var(--muted);">Hizalama Kalitesi:</span>
        <span style="color:${scoreColor};font-weight:600;">${quality.score}/100 — ${quality.quality}</span>
      </div>
      <div style="margin-top:0.2rem;font-size:0.6rem;color:var(--muted);">
        RMSE: ${quality.score > 0 ? (quality.score * 0.05).toFixed(2) : '—'}m · ${pts.length} nokta
      </div>
      <div style="font-size:0.6rem;color:var(--muted);">${quality.details}</div>
    </div>
  `;
}

// ── Başlatma ──

export function bindUnifiedPanel() {
  const panel = document.getElementById('unified-panel');
  if (!panel || panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';

  console.log('[UnifiedPanel] Bağlandı');
  bindThresholdSliders();
  bindClickToAlign();

  // Image seç
  document.getElementById('btn-unified-image')?.addEventListener('click', handleImagePick);

  // Başlat
  document.getElementById('btn-unified-start')?.addEventListener('click', handleStart);

  // CSV durumunu kontrol et
  checkCsvStatus();
  setInterval(checkCsvStatus, 2000);

  // İlk durum
  updateStartButton();
}

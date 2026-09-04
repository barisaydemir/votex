/**
 * Votex Mobile - 2D Map Colorizer
 * Applies LUT palettes to the map preview image
 */

// LUT Palette definitions
const PALETTES = {
  'kapalı': null,
  'manyetik-yogunluk': [
    [0, 0, 4], [0, 0, 22], [8, 0, 48], [24, 0, 80],
    [40, 0, 112], [56, 0, 144], [72, 0, 176], [88, 0, 208],
    [104, 0, 240], [120, 0, 255], [136, 16, 255], [152, 32, 255],
    [168, 48, 255], [184, 64, 255], [200, 80, 255], [216, 96, 255]
  ],
  'sicak-noktalar': [
    [0, 0, 32], [0, 16, 64], [0, 32, 96], [0, 48, 128],
    [0, 64, 160], [0, 80, 192], [0, 96, 224], [0, 112, 255],
    [0, 144, 255], [0, 176, 255], [0, 208, 255], [32, 240, 255],
    [96, 255, 255], [160, 255, 255], [224, 255, 255], [255, 255, 255]
  ],
  'toprak-profil': [
    [30, 10, 0], [60, 20, 0], [90, 30, 0], [120, 40, 0],
    [150, 60, 10], [180, 80, 20], [200, 100, 40], [220, 120, 60],
    [240, 140, 80], [255, 160, 100], [255, 180, 120], [255, 200, 140],
    [255, 220, 160], [255, 235, 180], [255, 245, 200], [255, 255, 220]
  ],
  'yeralti-yapisi': [
    [0, 16, 0], [0, 32, 0], [0, 48, 0], [0, 64, 0],
    [0, 80, 0], [0, 96, 0], [0, 112, 0], [0, 128, 0],
    [0, 160, 32], [0, 192, 64], [0, 224, 96], [32, 255, 128],
    [96, 255, 160], [160, 255, 192], [224, 255, 224], [255, 255, 255]
  ],
  'su-kaynaklari': [
    [0, 0, 32], [0, 0, 64], [0, 0, 96], [0, 0, 128],
    [0, 0, 160], [0, 0, 192], [0, 0, 224], [0, 0, 255],
    [0, 32, 255], [0, 64, 255], [0, 96, 255], [0, 128, 255],
    [0, 160, 255], [0, 192, 255], [0, 224, 255], [0, 255, 255]
  ]
};

// State
let _currentPalette = 'kapalı';
let _overlayOpacity = 1;
let _crossfadeRAF = null;
let _rawImage = null;
let _crossfadeCanvas = null;
let _crossfadeCtx = null;

// DOM Elements
let _previewImg = null;
let _overlayCanvas = null;
let _overlayCtx = null;

/**
 * Initialize the colorizer
 */
function initColorizer() {
  _previewImg = document.getElementById('preview');
  _overlayCanvas = document.getElementById('preview-colorized');
  _overlayCtx = _overlayCanvas.getContext('2d');

  // Create crossfade canvas
  _crossfadeCanvas = document.createElement('canvas');
  _crossfadeCtx = _crossfadeCanvas.getContext('2d');

  // Bind controls
  bindSwatches();
  bindOpacitySlider();
  bindExportButton();
}

/**
 * Bind palette swatches
 */
function bindSwatches() {
  const container = document.getElementById('map-colorizer-swatches');
  if (!container) return;

  container.innerHTML = '';

  Object.keys(PALETTES).forEach((key) => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch' + (key === 'kapalı' ? ' off' : '') + (key === _currentPalette ? ' active' : '');
    swatch.dataset.palette = key;

    if (key !== 'kapalı') {
      // Draw gradient preview
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 14;
      const ctx = canvas.getContext('2d');
      const palette = PALETTES[key];
      const gradient = ctx.createLinearGradient(0, 0, 32, 0);

      palette.forEach((color, i) => {
        const stop = i / (palette.length - 1);
        gradient.addColorStop(stop, `rgb(${color[0]}, ${color[1]}, ${color[2]})`);
      });

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 32, 14);
      swatch.style.backgroundImage = `url(${canvas.toDataURL()})`;
      swatch.style.backgroundSize = 'cover';
    }

    swatch.addEventListener('click', () => applyPalette(key));
    container.appendChild(swatch);
  });
}

/**
 * Apply a palette to the map preview
 */
function applyPalette(paletteKey) {
  if (!_previewImg || !_previewImg.src) {
    showToast('Önce bir harita yükleyin', 'error');
    return;
  }

  const wasSyncing = window._syncingFrom3D || false;

  if (paletteKey === 'kapalı') {
    restoreOriginal();
    if (!wasSyncing) {
      window._syncingFrom3D = false;
    }
    return;
  }

  _currentPalette = paletteKey;

  // Update swatch UI
  document.querySelectorAll('.swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.palette === paletteKey);
  });

  // Render colorized image
  renderColorized(paletteKey);

  // Show overlay
  _overlayCanvas.classList.add('visible');
  _overlayCanvas.style.opacity = _overlayOpacity;

  // Sync with 3D if available
  if (window.__applyColorizer3D && !wasSyncing) {
    window.__applyColorizer3D(paletteKey);
  }
}

/**
 * Render colorized image to canvas
 */
function renderColorized(paletteKey) {
  const img = _previewImg;
  if (!img || !img.naturalWidth) return;

  _overlayCanvas.width = img.naturalWidth;
  _overlayCanvas.height = img.naturalHeight;

  // Draw raw image
  _overlayCtx.drawImage(img, 0, 0);

  // Get image data
  const imageData = _overlayCtx.getImageData(0, 0, _overlayCanvas.width, _overlayCanvas.height);
  const data = imageData.data;

  // Apply LUT
  const palette = PALETTES[paletteKey];
  if (!palette) return;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Convert to grayscale intensity
    const intensity = Math.floor((r * 0.299 + g * 0.587 + b * 0.114) / 16);
    const idx = Math.min(intensity, palette.length - 1);

    data[i] = palette[idx][0];
    data[i + 1] = palette[idx][1];
    data[i + 2] = palette[idx][2];
  }

  _overlayCtx.putImageData(imageData, 0, 0);
}

/**
 * Restore original image (remove colorization)
 */
function restoreOriginal() {
  _currentPalette = 'kapalı';

  // Update swatch UI
  document.querySelectorAll('.swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.palette === 'kapalı');
  });

  // Hide overlay
  _overlayCanvas.classList.remove('visible');

  // Sync with 3D if available
  if (window.__restoreColorizer3D) {
    window.__restoreColorizer3D();
  }
}

/**
 * Bind opacity slider
 */
function bindOpacitySlider() {
  const slider = document.getElementById('map-colorizer-opacity');
  const label = document.getElementById('opacity-label');
  if (!slider || !label) return;

  slider.addEventListener('input', () => {
    const pct = parseInt(slider.value);
    _overlayOpacity = pct / 100;
    label.textContent = pct + '%';

    if (_overlayCanvas.classList.contains('visible')) {
      _overlayCanvas.style.opacity = _overlayOpacity;
    }
  });
}

/**
 * Bind export button
 */
function bindExportButton() {
  const btn = document.getElementById('btn-map-color-export');
  if (!btn) return;

  btn.addEventListener('click', exportColoredMap);
}

/**
 * Export colored map as PNG
 */
function exportColoredMap() {
  if (!_previewImg || !_previewImg.src) {
    showToast('Dışa aktarılacak harita yok', 'error');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = _previewImg.naturalWidth;
  canvas.height = _previewImg.naturalHeight;
  const ctx = canvas.getContext('2d');

  // Draw raw image
  ctx.drawImage(_previewImg, 0, 0);

  // Overlay colorized version
  if (_overlayCanvas.classList.contains('visible')) {
    ctx.globalAlpha = _overlayOpacity;
    ctx.drawImage(_overlayCanvas, 0, 0);
  }

  // Generate filename
  const baseName = _previewImg.src.split('/').pop().split('.')[0] || 'harita';
  const suffix = _currentPalette !== 'kapalı' ? `_${_currentPalette}` : '';
  const filename = `${baseName}${suffix}.png`;

  // Download
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`İndirildi: ${filename}`, 'success');
  }, 'image/png');
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

/**
 * Get current palette key
 */
function getCurrentPalette() {
  return _currentPalette;
}

// Export functions
window.VotexColorizer = {
  init: initColorizer,
  applyPalette,
  restoreOriginal,
  getCurrentPalette,
  exportColoredMap,
  showToast
};
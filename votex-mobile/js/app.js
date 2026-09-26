/**
 * Votex Mobile - Main Application
 * Dik Çekim (Vertical Survey) Mode
 */

// State
let _currentFile = null;
let _currentImageData = null;
let _currentSurface = null;
let _currentStructures = null;
let _currentWallCues = null;

/**
 * Initialize the application
 */
function initApp() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered'))
      .catch(err => console.error('Service Worker error:', err));
  }

  // Initialize modules
  VotexColorizer.init();
  VotexAI.init();
  VotexGPS.init();

  // WASM analysis core (non-blocking, falls back to JS silently)
  VotexWasm.init();

  // Anomaly overlay canvas
  VotexOverlay.init();

  // 3D surface preview panel
  VotexSurface3D.init();

  // Bind event listeners
  bindFileInput();
  bindDragDrop();
  bindNavigation();
  bindAnalysis();
  bindBenchmark();
  bindSurface3D();

  console.log('Votex Mobile initialized');
}

/**
 * Bind file input
 */
function bindFileInput() {
  const fileInput = document.getElementById('file-input');
  const selectBtn = document.getElementById('btn-select-file');

  if (selectBtn && fileInput) {
    selectBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
      }
    });
  }
}

/**
 * Bind drag and drop
 */
function bindDragDrop() {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
    dropZone.addEventListener(event, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(event => {
    dropZone.addEventListener(event, () => {
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    dropZone.addEventListener(event, () => {
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });
}

/**
 * Bind navigation
 */
function bindNavigation() {
  const backBtn = document.getElementById('btn-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showSection('upload');
    });
  }
}

/**
 * Bind analysis
 */
function bindAnalysis() {
  const analyzeBtn = document.getElementById('btn-analyze');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
      if (!_currentImageData) {
        VotexColorizer.showToast('Önce bir harita yükleyin', 'error');
        return;
      }

      showLoading('Analiz ediliyor...');

      try {
        // 1) WASM anomaly detection (same core as desktop backend)
        const wasmResult = VotexWasm.analyzeColormap(_currentImageData, {
          lutStripPx: 24,
          minArea: 80,
          threshold: 0.35
        });

        // 2) Basic metrics — WASM if ready, otherwise JS analyzer
        const stats = VotexWasm.imageStats(_currentImageData);
        const results = VotexAnalyzer.analyzeImage(_currentImageData);
        if (stats && results.metrics) {
          results.metrics.mean = stats.mean.toFixed(2);
          results.metrics.stdDev = stats.stdDev.toFixed(2);
          results.metrics.entropy = stats.entropy.toFixed(3);
        }

        VotexAnalyzer.renderResults(results);

        // 2b) Draw anomaly boxes on the map preview
        if (wasmResult && wasmResult.anomalies.length > 0) {
          VotexOverlay.draw(wasmResult.anomalies, {
            width: wasmResult.width,
            height: wasmResult.height
          });
        } else {
          VotexOverlay.clear();
        }

        // 2c) Build 3D surface field (cached for the 3D button)
        _currentSurface = VotexWasm.buildSurfaceField(_currentImageData, { gridW: 96, gridH: 96 });

        // 2d) Classify structures for 3D markers (room/tunnel/shaft)
        _currentStructures = VotexWasm.classifyStructures(wasmResult, {
          width: _currentImageData.width,
          height: _currentImageData.height
        });

        // 2e) Detect wall cues (green-line tunnel segments) for 3D view
        _currentWallCues = VotexWasm.detectWallCues(_currentImageData);

        // 3) WASM anomaly summary → toast + console detail
        if (wasmResult) {
          const structures = VotexWasm.anomaliesToStructures(wasmResult);
          const pos = wasmResult.anomalies.filter(a => a.class === 'positive').length;
          const neg = wasmResult.anomalies.filter(a => a.class === 'negative').length;
          const engine = VotexWasm.isReady() ? 'WASM (Rust çekirdeği)' : 'JS (yedek)';
          console.log(`[Analiz] Motor: ${engine}, Yapı:`, structures);
          VotexColorizer.showToast(
            `Analiz tamamlandı — ${pos} pozitif, ${neg} negatif bölge (${engine})`,
            'success'
          );
        } else {
          VotexColorizer.showToast('Analiz tamamlandı (JS motoru)', 'success');
        }
      } catch (err) {
        console.error('Analysis error:', err);
        VotexColorizer.showToast('Analiz hatası: ' + (err?.message || err), 'error');
      } finally {
        hideLoading();
      }
    });
  }
}

/**
 * Bind 3D surface view button
 */
function bindSurface3D() {
  const btn = document.getElementById('btn-3d-view');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!_currentSurface) {
      // Build on demand if analysis hasn't run yet
      if (_currentImageData) {
        showLoading('3D yüzey oluşturuluyor...');
        setTimeout(() => {
          _currentSurface = VotexWasm.buildSurfaceField(_currentImageData, { gridW: 96, gridH: 96 });
          _currentStructures = null; // structures need analysis first
          _currentWallCues = null;   // wall cues need analysis first
          hideLoading();
          if (_currentSurface) {
            VotexSurface3D.show(_currentSurface, _currentStructures, _currentWallCues);
          } else {
            VotexColorizer.showToast('3D yüzey için WASM gerekli', 'error');
          }
        }, 50);
      } else {
        VotexColorizer.showToast('Önce bir harita yükleyin', 'error');
      }
      return;
    }
    VotexSurface3D.show(_currentSurface, _currentStructures, _currentWallCues);
  });
}

/**
 * Bind benchmark button + panel close
 */
function bindBenchmark() {
  const benchBtn = document.getElementById('btn-benchmark');
  const closeBtn = document.getElementById('btn-benchmark-close');

  if (benchBtn) {
    benchBtn.addEventListener('click', async () => {
      if (!_currentImageData) {
        VotexColorizer.showToast('Kıyaslama için önce bir harita yükleyin', 'error');
        return;
      }

      benchBtn.disabled = true;
      showLoading('Kıyaslama çalışıyor...');

      try {
        const results = await VotexBenchmark.runBenchmark({
          onProgress: (msg) => {
            const t = document.getElementById('loading-text');
            if (t) t.textContent = msg;
          }
        });
        VotexBenchmark.renderBenchmark(results);
        console.table(results.rows.map(r => ({
          map: r.label, js_ms: r.jsMs, wasm_ms: r.wasmMs, speedup: r.speedup, match: r.match
        })));
      } catch (err) {
        console.error('Benchmark error:', err);
        VotexColorizer.showToast('Kıyaslama hatası: ' + (err?.message || err), 'error');
      } finally {
        benchBtn.disabled = false;
        hideLoading();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('benchmark-panel')?.classList.add('hidden');
    });
  }
}

/**
 * Handle file selection
 */
function handleFile(file) {
  // Validate file type
  const validTypes = ['.elic', '.png', '.jpg', '.jpeg', '.bmp', '.tiff'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (!validTypes.includes(ext)) {
    VotexColorizer.showToast('Geçersiz dosya formatı', 'error');
    return;
  }

  _currentFile = file;
  showLoading('Harita yükleniyor...');

  const reader = new FileReader();

  reader.onload = (e) => {
    const img = document.getElementById('preview');
    if (img) {
      img.onload = () => {
        // Get image data for analysis
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        _currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        hideLoading();
        showSection('map');
        VotexColorizer.showToast(`Yüklendi: ${file.name}`, 'success');

        // Clear previous anomaly overlay + surface for the new map
        VotexOverlay.clear();
        _currentSurface = null;
        _currentStructures = null;
        _currentWallCues = null;

        // Save GPS location for this map
        const location = VotexGPS.saveLocationForMap(file.name);
        if (location) {
          console.log('GPS location saved:', location);
        }
      };

      img.onerror = () => {
        hideLoading();
        VotexColorizer.showToast('Resim yüklenemedi', 'error');
      };

      img.src = e.target.result;
    }
  };

  reader.onerror = () => {
    hideLoading();
    VotexColorizer.showToast('Dosya okunamadı', 'error');
  };

  reader.readAsDataURL(file);
}

/**
 * Show section
 */
function showSection(name) {
  const uploadSection = document.getElementById('upload-section');
  const mapSection = document.getElementById('map-section');

  if (name === 'upload') {
    uploadSection?.classList.remove('hidden');
    mapSection?.classList.add('hidden');
  } else if (name === 'map') {
    uploadSection?.classList.add('hidden');
    mapSection?.classList.remove('hidden');
  }
}

/**
 * Show loading overlay
 */
function showLoading(text = 'İşleniyor...') {
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');

  if (overlay) {
    overlay.classList.remove('hidden');
  }

  if (loadingText) {
    loadingText.textContent = text;
  }
}

/**
 * Hide loading overlay
 */
function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  VotexColorizer.showToast(message, type);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
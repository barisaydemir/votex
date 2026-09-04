/**
 * Votex Mobile - Main Application
 * Dik Çekim (Vertical Survey) Mode
 */

// State
let _currentFile = null;
let _currentImageData = null;

/**
 * Initialize the application
 */
function initApp() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registered'))
      .catch(err => console.error('Service Worker error:', err));
  }

  // Initialize modules
  VotexColorizer.init();
  VotexAI.init();
  VotexGPS.init();

  // Bind event listeners
  bindFileInput();
  bindDragDrop();
  bindNavigation();
  bindAnalysis();

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
    analyzeBtn.addEventListener('click', () => {
      if (_currentImageData) {
        showLoading('Analiz ediliyor...');

        // Simulate processing delay
        setTimeout(() => {
          const results = VotexAnalyzer.analyzeImage(_currentImageData);
          VotexAnalyzer.renderResults(results);
          hideLoading();
          VotexColorizer.showToast('Analiz tamamlandı', 'success');
        }, 500);
      } else {
        VotexColorizer.showToast('Önce bir harita yükleyin', 'error');
      }
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
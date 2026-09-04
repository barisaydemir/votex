/**
 * Votex Mobile - AI Server Client
 * Connects to ai-server/ (FastAPI + Ollama) for server-side analysis
 */

// State
let _serverUrl = 'http://127.0.0.1:8080';
let _connected = false;
let _models = [];
let _selectedModel = null;
let _statusPolling = null;

// DOM Elements
let _statusDot = null;
let _statusText = null;
let _modelSelect = null;
let _connectBtn = null;

/**
 * Initialize AI client
 */
function initAIClient() {
  _statusDot = document.getElementById('ai-status-dot');
  _statusText = document.getElementById('ai-status-text');
  _modelSelect = document.getElementById('ai-model-select');
  _connectBtn = document.getElementById('ai-connect-btn');

  // Load saved server URL
  const savedUrl = localStorage.getItem('votex_ai_server_url');
  if (savedUrl) _serverUrl = savedUrl;

  // Bind UI
  bindServerControls();

  // Try auto-connect
  checkServerStatus();
}

/**
 * Bind server control UI
 */
function bindServerControls() {
  // Server URL input
  const urlInput = document.getElementById('ai-server-url');
  if (urlInput) {
    urlInput.value = _serverUrl;
    urlInput.addEventListener('change', (e) => {
      _serverUrl = e.target.value.replace(/\/+$/, '');
      localStorage.setItem('votex_ai_server_url', _serverUrl);
    });
  }

  // Connect button
  if (_connectBtn) {
    _connectBtn.addEventListener('click', () => {
      if (_connected) {
        disconnect();
      } else {
        connect();
      }
    });
  }

  // Model select
  if (_modelSelect) {
    _modelSelect.addEventListener('change', (e) => {
      _selectedModel = e.target.value || null;
    });
  }
}

/**
 * Check server status
 */
async function checkServerStatus() {
  try {
    const response = await fetch(`${_serverUrl}/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      _connected = true;
      _models = data.models_available || [];

      updateStatusUI(true, `Bağlı — ${_models.length} model`);
      updateModelSelect(_models);

      // Auto-select first vision model
      if (!_selectedModel && _models.length > 0) {
        const visionModel = _models.find(m => m.type === 'vision');
        if (visionModel) {
          _selectedModel = visionModel.name;
          if (_modelSelect) _modelSelect.value = _selectedModel;
        }
      }

      return true;
    }
  } catch (error) {
    // Server not reachable
  }

  _connected = false;
  updateStatusUI(false, 'Bağlı değil');
  return false;
}

/**
 * Connect to server
 */
async function connect() {
  if (_connectBtn) _connectBtn.disabled = true;

  const success = await checkServerStatus();

  if (!success) {
    showToast('AI sunucusuna bağlanılamadı. Sunucunun çalıştığından emin olun.', 'error');
  }

  if (_connectBtn) _connectBtn.disabled = false;
}

/**
 * Disconnect from server
 */
function disconnect() {
  _connected = false;
  _models = [];
  _selectedModel = null;

  updateStatusUI(false, 'Bağlı değil');
  updateModelSelect([]);

  if (_statusPolling) {
    clearInterval(_statusPolling);
    _statusPolling = null;
  }
}

/**
 * Update status UI
 */
function updateStatusUI(connected, text) {
  if (_statusDot) {
    _statusDot.style.background = connected ? '#3edc8c' : '#ff5252';
  }
  if (_statusText) {
    _statusText.textContent = text;
  }
  if (_connectBtn) {
    _connectBtn.textContent = connected ? 'Bağlantıyı Kes' : 'Bağlan';
    _connectBtn.className = connected ? 'btn btn-secondary' : 'btn btn-primary';
  }
}

/**
 * Update model select dropdown
 */
function updateModelSelect(models) {
  if (!_modelSelect) return;

  _modelSelect.innerHTML = '<option value="">Model seçin...</option>';

  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = `${model.name} (${model.type})`;
    if (model.name === _selectedModel) option.selected = true;
    _modelSelect.appendChild(option);
  });
}

/**
 * Analyze image using AI server
 */
async function analyzeImageWithAI(imageBase64, prompt) {
  if (!_connected) {
    throw new Error('AI sunucusu bağlı değil');
  }

  const model = _selectedModel || undefined;

  const response = await fetch(`${_serverUrl}/analyze/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_base64: imageBase64,
      prompt: prompt || 'Bu manyetik/harita görselinde yeraltı yapılarını analiz et. Odalar, tüneller, metal tespitleri ve su kaynaklarını belirle.',
      model: model,
      max_tokens: 2048
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Sunucu hatası: ${response.status}`);
  }

  return await response.json();
}

/**
 * Detect anomalies from data points
 */
async function detectAnomalies(dataPoints, context) {
  if (!_connected) {
    throw new Error('AI sunucusu bağlı değil');
  }

  const model = _selectedModel || undefined;

  const response = await fetch(`${_serverUrl}/detect/anomaly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data_points: dataPoints,
      context: context || '',
      model: model
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Sunucu hatası: ${response.status}`);
  }

  return await response.json();
}

/**
 * Generate report from analysis results
 */
async function generateReport(structures, surfaceInfo, language) {
  if (!_connected) {
    throw new Error('AI sunucusu bağlı değil');
  }

  const model = _selectedModel || undefined;

  const response = await fetch(`${_serverUrl}/generate/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structures: structures,
      surface_info: surfaceInfo,
      language: language || 'tr',
      model: model
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Sunucu hatası: ${response.status}`);
  }

  return await response.json();
}

/**
 * Chat with AI
 */
async function chat(message, stream) {
  if (!_connected) {
    throw new Error('AI sunucusu bağlı değil');
  }

  const model = _selectedModel || undefined;

  if (stream) {
    // Streaming response
    const response = await fetch(`${_serverUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        model: model,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`Sunucu hatası: ${response.status}`);
    }

    return response.body;
  }

  // Non-streaming
  const response = await fetch(`${_serverUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message,
      model: model,
      stream: false
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Sunucu hatası: ${response.status}`);
  }

  return await response.json();
}

/**
 * Get server status
 */
function getStatus() {
  return {
    connected: _connected,
    serverUrl: _serverUrl,
    models: _models,
    selectedModel: _selectedModel
  };
}

/**
 * Check if connected
 */
function isConnected() {
  return _connected;
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

// Export
window.VotexAI = {
  init: initAIClient,
  connect,
  disconnect,
  checkServerStatus,
  analyzeImageWithAI,
  detectAnomalies,
  generateReport,
  chat,
  getStatus,
  isConnected
};
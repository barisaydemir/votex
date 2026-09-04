/**
 * Votex Mobile - GPS Location Module
 * Records GPS coordinates when maps are loaded
 */

// State
let _currentPosition = null;
let _watching = false;
let _watchId = null;
let _locationHistory = [];

// DOM Elements
let _locationDisplay = null;
let _locationCoords = null;
let _locationAccuracy = null;
let _locationToggle = null;

/**
 * Initialize GPS module
 */
function initGPS() {
  _locationDisplay = document.getElementById('location-display');
  _locationCoords = document.getElementById('location-coords');
  _locationAccuracy = document.getElementById('location-accuracy');
  _locationToggle = document.getElementById('gps-toggle');

  // Load saved history
  loadHistory();

  // Bind toggle
  if (_locationToggle) {
    _locationToggle.addEventListener('click', toggleTracking);
  }

  // Check if geolocation is available
  if (!navigator.geolocation) {
    updateUI(null, 'Geolocation desteklenmiyor');
    if (_locationToggle) _locationToggle.disabled = true;
    return;
  }

  // Try to get current position
  getCurrentPosition();
}

/**
 * Get current GPS position
 */
function getCurrentPosition() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      _currentPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        altitude: position.coords.altitude,
        accuracy: position.coords.accuracy,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: position.timestamp
      };

      updateUI(_currentPosition, null);
      console.log('GPS position acquired:', _currentPosition);
    },
    (error) => {
      let message = 'Konum alınamadı';
      switch (error.code) {
        case error.PERMISSION_DENIED:
          message = 'Konum izni reddedildi';
          break;
        case error.POSITION_UNAVAILABLE:
          message = 'Konum bilgisi mevcut değil';
          break;
        case error.TIMEOUT:
          message = 'Konum isteği zaman aşımına uğradı';
          break;
      }
      updateUI(null, message);
      console.warn('GPS error:', message);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

/**
 * Start continuous position tracking
 */
function startTracking() {
  if (!navigator.geolocation || _watching) return;

  _watchId = navigator.geolocation.watchPosition(
    (position) => {
      _currentPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        altitude: position.coords.altitude,
        accuracy: position.coords.accuracy,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: position.timestamp
      };

      updateUI(_currentPosition, null);
    },
    (error) => {
      console.warn('GPS watch error:', error.message);
    },
    {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 1000
    }
  );

  _watching = true;
  updateToggleButton(true);
}

/**
 * Stop continuous position tracking
 */
function stopTracking() {
  if (_watchId !== null) {
    navigator.geolocation.clearWatch(_watchId);
    _watchId = null;
  }
  _watching = false;
  updateToggleButton(false);
}

/**
 * Toggle tracking on/off
 */
function toggleTracking() {
  if (_watching) {
    stopTracking();
  } else {
    startTracking();
  }
}

/**
 * Update UI with position data
 */
function updateUI(position, error) {
  if (_locationCoords) {
    if (position) {
      const lat = formatCoordinate(position.lat, 'lat');
      const lng = formatCoordinate(position.lng, 'lng');
      _locationCoords.textContent = `${lat}, ${lng}`;

      if (_locationAccuracy) {
        _locationAccuracy.textContent = `±${Math.round(position.accuracy)}m`;
      }
    } else if (error) {
      _locationCoords.textContent = error;
      if (_locationAccuracy) _locationAccuracy.textContent = '';
    }
  }
}

/**
 * Update toggle button state
 */
function updateToggleButton(active) {
  if (_locationToggle) {
    _locationToggle.classList.toggle('active', active);
    _locationToggle.textContent = active ? '📍 Takip Ediliyor' : '📍 Konum Al';
  }
}

/**
 * Format coordinate to string
 */
function formatCoordinate(value, type) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = Math.floor((abs - degrees) * 60);
  const seconds = ((abs - degrees) * 60 - minutes) * 60;
  const direction = type === 'lat'
    ? (value >= 0 ? 'N' : 'S')
    : (value >= 0 ? 'E' : 'W');

  return `${degrees}°${minutes}'${seconds.toFixed(1)}" ${direction}`;
}

/**
 * Format coordinate for display (decimal)
 */
function formatDecimal(value, decimals = 6) {
  return value.toFixed(decimals);
}

/**
 * Save location with current map
 */
function saveLocationForMap(mapName) {
  if (!_currentPosition) return null;

  const record = {
    mapName: mapName,
    lat: _currentPosition.lat,
    lng: _currentPosition.lng,
    altitude: _currentPosition.altitude,
    accuracy: _currentPosition.accuracy,
    timestamp: new Date().toISOString()
  };

  // Add to history
  _locationHistory.push(record);

  // Keep last 50 records
  if (_locationHistory.length > 50) {
    _locationHistory = _locationHistory.slice(-50);
  }

  // Save to localStorage
  saveHistory();

  return record;
}

/**
 * Get location for a specific map
 */
function getLocationForMap(mapName) {
  return _locationHistory.find(r => r.mapName === mapName) || null;
}

/**
 * Get all location history
 */
function getHistory() {
  return [..._locationHistory];
}

/**
 * Clear location history
 */
function clearHistory() {
  _locationHistory = [];
  saveHistory();
}

/**
 * Save history to localStorage
 */
function saveHistory() {
  try {
    localStorage.setItem('votex_gps_history', JSON.stringify(_locationHistory));
  } catch (e) {
    console.warn('Failed to save GPS history:', e);
  }
}

/**
 * Load history from localStorage
 */
function loadHistory() {
  try {
    const data = localStorage.getItem('votex_gps_history');
    if (data) {
      _locationHistory = JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to load GPS history:', e);
    _locationHistory = [];
  }
}

/**
 * Get current position
 */
function getCurrentPositionData() {
  return _currentPosition;
}

/**
 * Check if GPS is available
 */
function isAvailable() {
  return !!navigator.geolocation;
}

/**
 * Check if tracking is active
 */
function isTracking() {
  return _watching;
}

// Export
window.VotexGPS = {
  init: initGPS,
  getCurrentPosition: getCurrentPosition,
  startTracking,
  stopTracking,
  toggleTracking,
  saveLocationForMap,
  getLocationForMap,
  getHistory,
  clearHistory,
  getCurrentPositionData,
  isAvailable,
  isTracking,
  formatCoordinate,
  formatDecimal
};
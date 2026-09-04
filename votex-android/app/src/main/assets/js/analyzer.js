/**
 * Votex Mobile - Magnetic Analyzer
 * Client-side analysis for magnetic survey data
 */

// Analysis state
let _analysisResults = null;
let _rawImageData = null;

/**
 * Analyze the loaded image
 */
function analyzeImage(imageData) {
  if (!imageData) {
    return null;
  }

  _rawImageData = imageData;

  const results = {
    width: imageData.width,
    height: imageData.height,
    totalPixels: imageData.width * imageData.height,
    timestamp: new Date().toISOString(),
    metrics: {}
  };

  // Calculate basic metrics
  const metrics = calculateMetrics(imageData);
  results.metrics = metrics;

  _analysisResults = results;
  return results;
}

/**
 * Calculate image metrics
 */
function calculateMetrics(imageData) {
  const data = imageData.data;
  const pixels = imageData.width * imageData.height;

  let sum = 0;
  let min = 255;
  let max = 0;
  let histogram = new Array(256).fill(0);

  // Calculate histogram and basic stats
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const intensity = Math.floor(r * 0.299 + g * 0.587 + b * 0.114);

    sum += intensity;
    min = Math.min(min, intensity);
    max = Math.max(max, intensity);
    histogram[intensity]++;
  }

  const mean = sum / pixels;
  const variance = calculateVariance(data, mean);
  const stdDev = Math.sqrt(variance);

  // Find dominant colors
  const dominantColors = findDominantColors(data, 5);

  // Calculate gradient magnitude (edge detection)
  const gradientMagnitude = calculateGradientMagnitude(imageData);

  return {
    mean: mean.toFixed(2),
    min,
    max,
    stdDev: stdDev.toFixed(2),
    contrast: (max - min),
    dynamicRange: ((max - min) / 255 * 100).toFixed(1) + '%',
    histogram: histogram,
    dominantColors: dominantColors,
    gradientMagnitude: gradientMagnitude.toFixed(2),
    entropy: calculateEntropy(histogram, pixels).toFixed(3)
  };
}

/**
 * Calculate variance
 */
function calculateVariance(data, mean) {
  let sum = 0;
  const pixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const intensity = r * 0.299 + g * 0.587 + b * 0.114;
    sum += Math.pow(intensity - mean, 2);
  }

  return sum / pixels;
}

/**
 * Find dominant colors
 */
function findDominantColors(data, count) {
  // Simple color quantization
  const colorMap = {};
  const step = 16; // Quantize to 16 levels

  for (let i = 0; i < data.length; i += 4) {
    const r = Math.floor(data[i] / step) * step;
    const g = Math.floor(data[i + 1] / step) * step;
    const b = Math.floor(data[i + 2] / step) * step;
    const key = `${r},${g},${b}`;

    colorMap[key] = (colorMap[key] || 0) + 1;
  }

  // Sort by frequency
  const sorted = Object.entries(colorMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);

  return sorted.map(([color, count]) => ({
    rgb: color.split(',').map(Number),
    hex: '#' + color.split(',').map(c => parseInt(c).toString(16).padStart(2, '0')).join(''),
    percentage: ((count / (data.length / 4)) * 100).toFixed(1)
  }));
}

/**
 * Calculate gradient magnitude (simple edge detection)
 */
function calculateGradientMagnitude(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  let totalGradient = 0;
  let count = 0;

  // Sobel-like operator
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const idxLeft = (y * width + (x - 1)) * 4;
      const idxRight = (y * width + (x + 1)) * 4;
      const idxUp = ((y - 1) * width + x) * 4;
      const idxDown = ((y + 1) * width + x) * 4;

      // Get intensities
      const center = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      const left = data[idxLeft] * 0.299 + data[idxLeft + 1] * 0.587 + data[idxLeft + 2] * 0.114;
      const right = data[idxRight] * 0.299 + data[idxRight + 1] * 0.587 + data[idxRight + 2] * 0.114;
      const up = data[idxUp] * 0.299 + data[idxUp + 1] * 0.587 + data[idxUp + 2] * 0.114;
      const down = data[idxDown] * 0.299 + data[idxDown + 1] * 0.587 + data[idxDown + 2] * 0.114;

      // Calculate gradient
      const gx = right - left;
      const gy = down - up;
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      totalGradient += magnitude;
      count++;
    }
  }

  return count > 0 ? totalGradient / count : 0;
}

/**
 * Calculate entropy (information content)
 */
function calculateEntropy(histogram, totalPixels) {
  let entropy = 0;

  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i] > 0) {
      const p = histogram[i] / totalPixels;
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

/**
 * Render analysis results to UI
 */
function renderResults(results) {
  const container = document.getElementById('results-grid');
  if (!container || !results) return;

  const metrics = results.metrics;

  container.innerHTML = `
    <div class="result-card">
      <div class="result-label">Boyut</div>
      <div class="result-value">${results.width}×${results.height}</div>
      <div class="result-unit">piksel</div>
    </div>
    <div class="result-card">
      <div class="result-label">Toplam Piksel</div>
      <div class="result-value">${(results.totalPixels / 1000000).toFixed(2)}</div>
      <div class="result-unit">milyon</div>
    </div>
    <div class="result-card">
      <div class="result-label">Ortalama</div>
      <div class="result-value">${metrics.mean}</div>
      <div class="result-unit">0-255</div>
    </div>
    <div class="result-card">
      <div class="result-label">Std Sapma</div>
      <div class="result-value">${metrics.stdDev}</div>
      <div class="result-unit">dağılım</div>
    </div>
    <div class="result-card">
      <div class="result-label">Kontrast</div>
      <div class="result-value">${metrics.contrast}</div>
      <div class="result-unit">0-255</div>
    </div>
    <div class="result-card">
      <div class="result-label">Dinamik Aralık</div>
      <div class="result-value">${metrics.dynamicRange}</div>
      <div class="result-unit"></div>
    </div>
    <div class="result-card">
      <div class="result-label">Kenant</div>
      <div class="result-value">${metrics.gradientMagnitude}</div>
      <div class="result-unit">ort. gradyan</div>
    </div>
    <div class="result-card">
      <div class="result-label">Entropi</div>
      <div class="result-value">${metrics.entropy}</div>
      <div class="result-unit">bit</div>
    </div>
    <div class="result-card">
      <div class="result-label">Analiz Zamanı</div>
      <div class="result-value">${new Date(results.timestamp).toLocaleTimeString('tr-TR')}</div>
      <div class="result-unit"></div>
    </div>
  `;

  // Show results section
  document.getElementById('results-section')?.classList.remove('hidden');
}

/**
 * Get current analysis results
 */
function getAnalysisResults() {
  return _analysisResults;
}

// Export
window.VotexAnalyzer = {
  analyzeImage,
  renderResults,
  getAnalysisResults
};
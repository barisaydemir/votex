/**
 * dataProfiler.js — AUTO Akıllı Ayarlar · Veri Profili Çıkarıcı
 *
 * Yüklenen verinin (görsel ve/veya CSV) istatistiksel parmak izini çıkarır.
 * Auto-Tune motoru (autoTune.js) bu profili kullanarak parametre önerir.
 *
 * Tamamen bağımsız — silindiğinde hiçbir şey bozulmaz.
 *
 * Kullanım:
 *   import { profileImage, profileCsv, buildProfile, hashProfile } from "./dataProfiler.js";
 *   const profile = await buildProfile({ imageBase64, csvData });
 *   const hash = hashProfile(profile); // öğrenme döngüsü için parmak izi
 */

/* ── Profil Sabitleri ─────────────────────────────────── */

/** HSV analizinde örnekleme adımı (her N pikselde 1) — büyük görsellerde performans */
const IMAGE_SAMPLE_STEP = 3;

/** Yeşil bant (Proton ELIC nötr zemin) */
const GREEN_MIN = 70, GREEN_MAX = 170;
/** Kırmızı bant (pozitif anomali / metal) */
const RED_LO = 330, RED_HI = 30;
/** Mavi bant (negatif anomali / boşluk-su) */
const BLUE_MIN = 180, BLUE_MAX = 260;

/* ── Yardımcılar ─────────────────────────────────────── */

/** RGB → HSV (0-360, 0-1, 0-1) */
export function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max < 1e-6 ? 0 : d / max;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * (((bn - rn) / d) + 2);
    else h = 60 * (((rn - gn) / d) + 4);
  }
  if (h < 0) h += 360;
  return { h, s, v };
}

function isRedBand(h) {
  return h >= RED_LO || h <= RED_HI;
}
function isGreenBand(h) {
  return h >= GREEN_MIN && h <= GREEN_MAX;
}
function isBlueBand(h) {
  return h >= BLUE_MIN && h <= BLUE_MAX;
}

/** Sayıyı bucket'a yuvarla — profil hash'i için kaba nicel aralık */
function bucket(value, step) {
  return Math.round(value / step) * step;
}

/* ── Görsel Profili ───────────────────────────────────── */

/**
 * base64 görselden istatistiksel profil çıkar.
 * Proton ELIC harita renk dağılımını ölçer.
 *
 * @param {string} base64 - data:image/...;base64,.... (veya ham base64)
 * @returns {Promise<Object|null>} image profili (yükleme hatasında null)
 */
export function profileImage(base64) {
  return new Promise((resolve) => {
    if (!base64) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        // Çok büyük görsellerde alt-örnekle — profil için 512px yeter
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(8, Math.round(img.naturalWidth * scale));
        const h = Math.max(8, Math.round(img.naturalHeight * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;

        let total = 0;
        let redCount = 0, greenCount = 0, blueCount = 0;
        let brightCount = 0, darkCount = 0;
        let satSum = 0, satCount = 0;
        let redSatSum = 0, redBrightSum = 0;

        for (let i = 0; i < data.length; i += 4 * IMAGE_SAMPLE_STEP) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (data[i + 3] < 8) continue; // şeffaf
          const hsv = rgbToHsv(r, g, b);
          total++;
          satSum += hsv.s;
          if (hsv.s > 0.12) satCount++;
          if (isRedBand(hsv.h)) {
            if (hsv.s > 0.35 && hsv.v > 0.25) {
              redCount++;
              redSatSum += hsv.s;
              redBrightSum += hsv.v;
            }
          } else if (isGreenBand(hsv.h)) {
            greenCount++;
          } else if (isBlueBand(hsv.h)) {
            if (hsv.s > 0.35) blueCount++;
          }
          if (hsv.v > 0.85) brightCount++;
          else if (hsv.v < 0.15) darkCount++;
        }

        if (total < 32) return resolve(null);

        const avgSat = satSum / total;
        const redRatio = redCount / total;
        const greenRatio = greenCount / total;
        const blueRatio = blueCount / total;
        // Gürültü göstergesi: nötr yeşilin payı — yeşil baskınsa harita temiz zeminli
        // çok düşük yeşil = renk şeridi kaymış ya da tüm harita anomali dolu
        const lutOk = greenRatio > 0.08;
        // Anomali yoğunluğu 0-1: kırmızı+mavi payı, 0.35'te doyar
        const anomalyLoad = Math.min(1, (redRatio + blueRatio) / 0.35);

        resolve({
          kind: "image",
          widthPx: img.naturalWidth,
          heightPx: img.naturalHeight,
          redRatio,
          greenRatio,
          blueRatio,
          avgSaturation: avgSat,
          redSaturation: redCount > 0 ? redSatSum / redCount : 0,
          redBrightness: redCount > 0 ? redBrightSum / redCount : 0,
          brightRatio: brightCount / total,
          darkRatio: darkCount / total,
          lutOk,
          anomalyLoad,
        });
      } catch (e) {
        console.warn("[DataProfiler] Görsel profili hatası:", e);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  });
}

/* ── CSV Profili ──────────────────────────────────────── */

/**
 * CsvImportResult ({ points: [{x,y,magnetic,...}], bounds }) verisinden
 * istatistiksel profil çıkar: yoğunluk, SNR, boşluk oranı...
 *
 * @param {Object} csvData - state.csvData
 * @returns {Object|null} csv profili (veri yoksa null)
 */
export function profileCsv(csvData) {
  const points = csvData?.points;
  if (!points || points.length < 4) return null;

  const b = csvData.bounds || computeBounds(points);
  const w = Math.max(1e-6, (b.xMax ?? b.xMin + 1) - (b.xMin ?? 0));
  const h = Math.max(1e-6, (b.yMax ?? b.yMin + 1) - (b.yMin ?? 0));
  const areaM2 = w * h;
  const pointCount = points.length;
  const density = pointCount / areaM2; // nokta/m²

  // Manyetik istatistikler
  let mMin = Infinity, mMax = -Infinity, sum = 0, sumSq = 0;
  for (const p of points) {
    const m = Number(p.magnetic) || 0;
    sum += m;
    sumSq += m * m;
    if (m < mMin) mMin = m;
    if (m > mMax) mMax = m;
  }
  const mean = sum / pointCount;
  const std = Math.sqrt(Math.max(0, sumSq / pointCount - mean * mean));
  const range = Math.max(1e-6, mMax - mMin);
  // SNR: sinyal aralığı / sapma — 2.5+ temiz, 1.5- gürültülü
  const snr = std > 1e-6 ? range / (4 * std) : 0;

  // Boşluk oranı: kabaca grid'e binleyip boş hücre payı
  const gapRatio = estimateGapRatio(points, b);

  return {
    kind: "csv",
    pointCount,
    areaM2,
    widthM: w,
    heightM: h,
    density,
    mMin,
    mMax,
    mean,
    std,
    snr,
    gapRatio,
  };
}

function computeBounds(points) {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of points) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, xMax, yMin, yMax };
}

/** Kaba grid'de boş hücre oranı — düzensiz tarama tespiti */
function estimateGapRatio(points, b, cells = 12) {
  const gw = Math.max(1e-6, (b.xMax ?? 1) - (b.xMin ?? 0));
  const gh = Math.max(1e-6, (b.yMax ?? 1) - (b.yMin ?? 0));
  const grid = new Uint8Array(cells * cells);
  let n = 0;
  for (const p of points) {
    const gx = Math.min(cells - 1, Math.max(0, Math.floor(((p.x - (b.xMin ?? 0)) / gw) * cells)));
    const gy = Math.min(cells - 1, Math.max(0, Math.floor(((p.y - (b.yMin ?? 0)) / gh) * cells)));
    const idx = gy * cells + gx;
    if (!grid[idx]) { grid[idx] = 1; n++; }
  }
  return 1 - n / (cells * cells);
}

/* ── Birleşik Profil ──────────────────────────────────── */

/**
 * Mevcut veri kaynaklarından tek bir profil nesnesi üret.
 *
 * @param {Object} src
 * @param {string} [src.imageBase64] - state.pendingFile.base64
 * @param {Object} [src.csvData] - state.csvData
 * @returns {Promise<Object>} { image, csv, sources: string[] }
 */
export async function buildProfile({ imageBase64, csvData } = {}) {
  const [image, csv] = await Promise.all([
    imageBase64 ? profileImage(imageBase64) : Promise.resolve(null),
    csvData ? profileCsv(csvData) : null,
  ]);
  const sources = [];
  if (image) sources.push("image");
  if (csv) sources.push("csv");
  return { image, csv, sources };
}

/* ── Profil Parmak İzi (Öğrenme Anahtarı) ─────────────── */

/**
 * Profilden kararlı bir hash üret — benzer veriler aynı anahtara düşer.
 * Kaba bucket'lara yuvarlanır ki aynı tip saha verisi aynı öğrenme kaydına uysun.
 *
 * @param {Object} profile - buildProfile() sonucu
 * @returns {string} profil anahtarı (örn: "img-r20-g50-b5")
 */
export function hashProfile(profile) {
  if (!profile) return "none";
  const parts = [];
  const img = profile.image;
  if (img) {
    parts.push(`img-r${bucket(img.redRatio * 100, 10)}-g${bucket(img.greenRatio * 100, 10)}-b${bucket(img.blueRatio * 100, 10)}`);
  }
  const csv = profile.csv;
  if (csv) {
    parts.push(
      `csv-d${bucket(csv.density, 1)}-s${bucket(csv.snr, 1)}-g${bucket(csv.gapRatio * 100, 10)}-a${bucket(csv.areaM2, 50)}`
    );
  }
  return parts.join("+") || "none";
}

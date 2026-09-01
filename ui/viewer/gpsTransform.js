/**
 * gpsTransform.js — WGS84 GPS ↔ Lokal metre dönüşümü.
 *
 * CSV'de GPS (lat/lon) sütunları olmadığında kullanıcı manuel olarak
 * bir referans noktası girer. Bu noktadan itibaren tüm lokal koordinatlar
 * GPS'ye çevrilir (veya tam tersi).
 *
 * Kullanım:
 *   import { setGpsReference, localToGps, gpsToLocal, getGpsState } from "./gpsTransform.js";
 *
 *   // Kullanıcı referans noktası girer:
 *   setGpsReference({ lat: 40.1234, lon: 29.5678 }, { localX: 0, localZ: 0 });
 *
 *   // Lokal koordinat GPS'ye:
 *   const gps = localToGps(25.4, 12.8); // → { lat: 40.1235, lon: 29.5680 }
 *
 *   // GPS lokal koordinata:
 *   const local = gpsToLocal(40.1235, 29.5680); // → { x: 25.4, z: 12.8 }
 */

// ── State ──────────────────────────────────────────────────────

let _gpsRef = null;   // { lat, lon }
let _localRef = null;  // { x, z } — GPS referansının lokal karşılığı
let _bearing = 0;      // Kuzey yönü (gradyan)

// ── Haversine ──────────────────────────────────────────────────

const EARTH_R = 6371000; // metre

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

/**
 * İki GPS noktası arasındaki mesafe ve yön (metre).
 * @returns {{ distance: number, bearing: number }}
 */
function haversine(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a = Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_R * c;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

  return { distance, bearing };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * GPS referans noktasını ayarla.
 * @param {{ lat: number, lon: number }} gps - GPS koordinatı
 * @param {{ x: number, z: number }} [local] - Lokal karşılığı (varsayılan: 0,0)
 */
export function setGpsReference(gps, local) {
  _gpsRef = { lat: gps.lat, lon: gps.lon };
  _localRef = local || { x: 0, z: 0 };
  _bearing = 0;
  console.log(`[GPS] Referans: ${gps.lat.toFixed(6)}°N, ${gps.lon.toFixed(6)}°E → lokal (${_localRef.x}, ${_localRef.z})`);
}

/**
 * İkinci referans noktası ekle (daha doğru dönüşüm — döndürme dahil).
 */
export function setGpsReference2(gps2, local2) {
  if (!_gpsRef || !_localRef) return;
  const d = haversine(_gpsRef.lat, _gpsRef.lon, gps2.lat, gps2.lon);
  _bearing = d.bearing;
  console.log(`[GPS] 2. referans: d=${d.distance.toFixed(1)}m, bearing=${d.bearing.toFixed(1)}°`);
}

/**
 * GPS referansını temizle.
 */
export function clearGpsReference() {
  _gpsRef = null;
  _localRef = null;
  _bearing = 0;
  console.log("[GPS] Referans temizlendi");
}

/**
 * Mevcut GPS durumunu döndür.
 */
export function getGpsState() {
  return {
    active: !!_gpsRef,
    gpsRef: _gpsRef ? { ..._gpsRef } : null,
    localRef: _localRef ? { ..._localRef } : null,
    bearing: _bearing,
  };
}

/**
 * Lokal koordinatı GPS'ye çevir.
 * @param {number} localX - Lokal X (metre)
 * @param {number} localZ - Lokal Z (metre)
 * @returns {{ lat: number, lon: number, bearing: number, distance: number }}
 */
export function localToGps(localX, localZ) {
  if (!_gpsRef || !_localRef) return null;

  const dx = localX - _localRef.x;
  const dz = localZ - _localRef.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Döndürme varsa uygula
  let angle = Math.atan2(dz, dx);
  if (_bearing) {
    angle += toRad(_bearing);
  }

  // Kuzey (dz) ve Doğu (dx) bileşenleri
  const north = dist * Math.cos(angle);
  const east = dist * Math.sin(angle);

  // Enlem/boylam farklılığı
  const dLat = north / EARTH_R;
  const dLon = east / (EARTH_R * Math.cos(toRad(_gpsRef.lat)));

  return {
    lat: _gpsRef.lat + toDeg(dLat),
    lon: _gpsRef.lon + toDeg(dLon),
    bearing: _bearing,
    distance: dist,
  };
}

/**
 * GPS koordinatını lokal koordinata çevir.
 * @param {number} lat - Enlem
 * @param {number} lon - Boylam
 * @returns {{ x: number, z: number }}
 */
export function gpsToLocal(lat, lon) {
  if (!_gpsRef || !_localRef) return null;

  const d = haversine(_gpsRef.lat, _gpsRef.lon, lat, lon);
  let angle = toRad(d.bearing);
  if (_bearing) {
    angle -= toRad(_bearing);
  }

  const dx = d.distance * Math.cos(angle);
  const dz = d.distance * Math.sin(angle);

  return {
    x: _localRef.x + dx,
    z: _localRef.z + dz,
  };
}

/**
 * Nokta dizisine GPS koordinatları ekle.
 * @param {Array} points - [{ x, z, ... }]
 * @returns {Array} - [{ x, z, lat, lon, ... }]
 */
export function enrichWithGps(points) {
  if (!_gpsRef) return points;
  return points.map(p => {
    const gps = localToGps(p.x, p.z);
    return gps ? { ...p, lat: gps.lat, lon: gps.lon } : p;
  });
}

/**
 * Google Maps URL'si oluştur.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function googleMapsUrl(lat, lon) {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/**
 * DMS formatında göster.
 * @param {number} decimal
 * @param {'lat'|'lon'} type
 * @returns {string}
 */
export function toDMS(decimal, type) {
  const dir = type === 'lat' ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
  const abs = Math.abs(decimal);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${d}°${m}'${s}"${dir}`;
}

/**
 * Magnetic declination düzeltmesi (basit yaklaşım).
 * Manyetik kuzey ile gerçek kuzey arasındaki fark.
 * @param {number} magneticBearing - manyetik pusula yönü (derece)
 * @param {number} declination - manyetik sapma (derece, pozitif = doğu)
 * @returns {number} true bearing
 */
export function magneticToTrue(magneticBearing, declination = 0) {
  return (magneticBearing + declination + 360) % 360;
}

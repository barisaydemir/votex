/**
 * kmlExport.js — KML/Google Earth dışa aktarma.
 *
 * Tespit edilen yapıları (oda, tünel, metal) GPS koordinatlarıyla
 * KML formatında dışa aktarır. Google Earth'te doğrudan açılabilir.
 *
 * Kullanım:
 *   import { exportToKml } from "./kmlExport.js";
 *   exportToKml(); // mevcut analiz sonuçlarını KML olarak indir
 */
import { state } from "../app/state.js";
import { localToGps, getGpsState } from "../viewer/gpsTransform.js";
import { setStatus } from "../app/status.js";
import { logLine } from "./telemetry.js";

// ── KML Şablonları ──

function kmlHeader(name, description) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escXml(name)}</name>
    <description>${escXml(description)}</description>
    <Style id="style-chamber">
      <IconStyle>
        <color>ff00aa00</color>
        <scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.9</scale></LabelStyle>
    </Style>
    <Style id="style-tunnel">
      <IconStyle>
        <color>ffaa5500</color>
        <scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.9</scale></LabelStyle>
    </Style>
    <Style id="style-metal">
      <IconStyle>
        <color>ff0000ff</color>
        <scale>1.4</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/star.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.9</scale></LabelStyle>
    </Style>
    <Style id="style-water">
      <IconStyle>
        <color>ffff6600</color>
        <scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/water.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.9</scale></LabelStyle>
    </Style>
    <Style id="style-ref-point">
      <IconStyle>
        <color>ff00ffff</color>
        <scale>1.0</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.8</scale></LabelStyle>
    </Style>`;
}

function kmlFooter() {
  return `  </Document>
</kml>`;
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Placemark Üretimi ──

function makePlacemark(name, lat, lon, alt, styleId, description, coords) {
  let xml = `    <Placemark>
      <name>${escXml(name)}</name>
      <styleUrl>#${styleId}</styleUrl>
      <description><![CDATA[${description}]]></description>`;

  if (coords && coords.length >= 2) {
    // Çoklu koordinat (poligon veya çizgi)
    const coordStr = coords.map(c => `${c.lon},${c.lat},${c.alt || 0}`).join('\n        ');
    if (coords.length > 2 && coords[0].lon === coords[coords.length - 1].lon && coords[0].lat === coords[coords.length - 1].lat) {
      // Kapalı poligon
      xml += `
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
        ${coordStr}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>`;
    } else {
      // Çizgi
      xml += `
      <LineString>
        <coordinates>
        ${coordStr}
        </coordinates>
        <altitudeMode>relativeToGround</altitudeMode>
      </LineString>`;
    }
  } else {
    // Tek nokta
    xml += `
      <Point>
        <coordinates>${lon},${lat},${alt || 0}</coordinates>
        <altitudeMode>relativeToGround</altitudeMode>
      </Point>`;
  }

  xml += `
    </Placemark>`;
  return xml;
}

// ── Yapı Dönüştürme ──

function convertChamber(ch, idx, gpsState) {
  const gps = localToGps(ch.cx, ch.cy);
  if (!gps) return null;

  const depth = ((ch.topFromSurfaceM || 0) + (ch.bottomFromSurfaceM || 0)) / 2;
  const desc = [
    `<b>Oda / Mezar #${idx + 1}</b>`,
    `Güven: ${(ch.strength * 100).toFixed(0)}%`,
    `Derinlik: ~${depth.toFixed(1)}m`,
    `Boyut: ${(ch.widthM || 0).toFixed(1)}m × ${(ch.lengthM || 0).toFixed(1)}m`,
    `GPS: ${gps.lat.toFixed(6)}°N, ${gps.lon.toFixed(6)}°E`,
    `Google Maps: <a href="https://maps.google.com/?q=${gps.lat},${gps.lon}">Aç</a>`,
  ].join('<br/>');

  // Köşe noktaları (basit dikdörtgen)
  const hw = (ch.widthM || 2) / 2;
  const hl = (ch.lengthM || 2) / 2;
  const corners = [
    localToGps(ch.cx - hw, ch.cy - hl),
    localToGps(ch.cx + hw, ch.cy - hl),
    localToGps(ch.cx + hw, ch.cy + hl),
    localToGps(ch.cx - hw, ch.cy + hl),
    localToGps(ch.cx - hw, ch.cy - hl), // kapat
  ].filter(Boolean);

  return makePlacemark(
    `🏛️ Oda #${idx + 1}`,
    gps.lat, gps.lon, -depth,
    'style-chamber', desc,
    corners.length >= 2 ? corners.map(c => ({ ...c, alt: -depth })) : null
  );
}

function convertTunnel(t, idx, gpsState) {
  const gps0 = localToGps(t.x0, t.y0);
  const gps1 = localToGps(t.x1, t.y1);
  if (!gps0 || !gps1) return null;

  const depth = t.floorFromSurfaceM || 0;
  const desc = [
    `<b>Tünel #${idx + 1}</b>`,
    `Güven: ${(t.strength * 100).toFixed(0)}%`,
    `Derinlik: ~${depth.toFixed(1)}m`,
    `Genişlik: ${(t.widthM || 0).toFixed(1)}m`,
    `GPS Başlangıç: ${gps0.lat.toFixed(6)}°N, ${gps0.lon.toFixed(6)}°E`,
    `GPS Bitiş: ${gps1.lat.toFixed(6)}°N, ${gps1.lon.toFixed(6)}°E`,
  ].join('<br/>');

  return makePlacemark(
    `🚇 Tünel #${idx + 1}`,
    (gps0.lat + gps1.lat) / 2, (gps0.lon + gps1.lon) / 2, -depth,
    'style-tunnel', desc,
    [
      { lat: gps0.lat, lon: gps0.lon, alt: -depth },
      { lat: gps1.lat, lon: gps1.lon, alt: -depth },
    ]
  );
}

function convertMetal(m, idx, gpsState) {
  const gps = localToGps(m.cx, m.cy);
  if (!gps) return null;

  const depth = m.depthFromSurfaceM || 0;
  const desc = [
    `<b>Metal Anomali #${idx + 1}</b>`,
    `Güven: ${(m.strength * 100).toFixed(0)}%`,
    `Derinlik: ~${depth.toFixed(1)}m`,
    `Boyut: ${(m.widthM || 0).toFixed(1)}m × ${(m.lengthM || 0).toFixed(1)}m`,
    `Alan Şiddeti: ${(m.fieldStrength || 0).toFixed(2)}`,
    `GPS: ${gps.lat.toFixed(6)}°N, ${gps.lon.toFixed(6)}°E`,
    `Google Maps: <a href="https://maps.google.com/?q=${gps.lat},${gps.lon}">Aç</a>`,
  ].join('<br/>');

  return makePlacemark(
    `🧲 Metal #${idx + 1}`,
    gps.lat, gps.lon, -depth,
    'style-metal', desc
  );
}

// ── Ana Dışa Aktarma Fonksiyonu ──

/**
 * Mevcut analiz sonuçlarını KML olarak dışa aktar.
 * GPS referansı ayarlı değilse uyarı verir.
 */
export function exportToKml() {
  const gpsState = getGpsState();
  if (!gpsState.active) {
    setStatus('KML için GPS referansı gerekli');
    logLine('KML dışa aktarma başarısız: GPS referansı ayarlanmamış', 'err');
    alert('KML dışa aktarma için önce GPS referans noktasını ayarlayın.\n\nSol menü → CSV → 📍 GPS KOORDINAT DESTEĞİ');
    return;
  }

  // Yapı verilerini al
  const structures = state.csvStructures;
  if (!structures) {
    setStatus('Dışa aktarılacak yapı yok');
    logLine('KML dışa aktarma başarısız: Analiz henüz yapılmamış', 'err');
    alert('Önce CSV analizi çalıştırın.');
    return;
  }

  const { chambers = [], tunnels = [], metals = [] } = structures;
  const total = chambers.length + tunnels.length + metals.length;

  if (total === 0) {
    setStatus('Dışa aktarılacak yapı bulunamadı');
    alert('Analiz sonucunda hiç yapı tespit edilemedi.');
    return;
  }

  // KML oluştur
  const now = new Date().toLocaleDateString('tr-TR');
  let kml = kmlHeader(
    `Votex Analiz — ${now}`,
    `${total} yapı tespit edildi: ${chambers.length} oda, ${tunnels.length} tünel, ${metals.length} metal. GPS: ${gpsState.gpsRef.lat.toFixed(4)}°N, ${gpsState.gpsRef.lon.toFixed(4)}°E`
  );

  // GPS Referans noktası
  kml += '\n' + makePlacemark(
    '📍 Referans Noktası',
    gpsState.gpsRef.lat, gpsState.gpsRef.lon, 0,
    'style-ref-point',
    `GPS Referans: ${gpsState.gpsRef.lat.toFixed(6)}°N, ${gpsState.gpsRef.lon.toFixed(6)}°E`
  );

  // Oda/Mezarlar
  chambers.forEach((ch, i) => {
    const pm = convertChamber(ch, i, gpsState);
    if (pm) kml += '\n' + pm;
  });

  // Tüller
  tunnels.forEach((t, i) => {
    const pm = convertTunnel(t, i, gpsState);
    if (pm) kml += '\n' + pm;
  });

  // Metal anomalileri
  metals.forEach((m, i) => {
    const pm = convertMetal(m, i, gpsState);
    if (pm) kml += '\n' + pm;
  });

  kml += '\n' + kmlFooter();

  // İndir
  downloadKml(kml, `votex-analiz-${Date.now()}.kml`);

  setStatus(`KML dışa aktarıldı: ${total} yapı`);
  logLine(`KML dışa aktarıldı: ${chambers.length} oda, ${tunnels.length} tünel, ${metals.length} metal`, 'ok');
}

// ── İndirme Yardımcısı ──

function downloadKml(content, filename) {
  const blob = new Blob([content], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

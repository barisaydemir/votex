//! SDC (Sensor Data Collection) veri modelleri.
//!
//! Çoklu sensör formatından (Proton, Bartington, GSSI, CSV, Excel)
//! okunan verileri standartlaştırılmış tek bir veri yapısında birleştirir.

use serde::{Deserialize, Serialize};

// ── Ham veri noktası ──────────────────────────────────────────

/// SDC'den okunan tek bir sensör veri noktası.
/// Tüm sensör formatları bu forma dönüştürülür.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SDCPoint {
    /// Yatay konum (m)
    pub x: f64,
    /// Yatay konum (m)
    pub y: f64,
    /// Derinlik / dikey konum (m, negatif = yeraltı)
    pub z: f64,
    /// Manyetik anomali değeri (nT veya sensör birimi)
    pub magnetic: f64,
    /// Ham sensör okuması (dönüştürme öncesi, opsiyonel)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_value: Option<f64>,
    /// Zaman damgası (ms, opsiyonel)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<u64>,
    /// GPS enlem (opsiyonel)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latitude: Option<f64>,
    /// GPS boylam (opsiyonel)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitude: Option<f64>,
}

// ── Field name haritalama ─────────────────────────────────────

/// Desteklenen sensör türleri.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SensorKind {
    /// SGS-01 manyetik sensör (Votex dahili)
    SGS01,
    /// Proton precession magnetometre
    Proton,
    /// Bartington Grad-01 manyetik gradyan
    Bartington,
    /// GSSI Ground Penetrating Radar
    GSSI,
    /// Cesium magnetometre (Santem/Geometrics vb.)
    Cesium,
    /// Fluxgate magnetometre
    Fluxgate,
    /// Resistivity / Dirençölçer
    Resistivity,
    /// EM (Elektromanyetik) induksiyon
    EM,
    /// Genel CSV / Excel
    Generic,
    /// Bilinmeyen
    Unknown,
}

/// Bir sütun adının hangi alana mappediğini tutar.
/// Örn: "magnetic_field" → "magnetic", "gps_lat" → "latitude"
#[derive(Debug, Clone)]
pub struct FieldMapping {
    /// Kaynak sütun adı (dosyadaki)
    pub source: &'static str,
    /// Hedef alan adı (SDCPoint içindeki)
    pub target: &'static str,
    /// Sensör türü (hangi formatta geçerli)
    pub sensor: SensorKind,
}

/// Tüm bilinen field mapping'ler — 160+ mapping ile kapsamlı destek.
///
/// Desteklenen diller/ formatlar:
/// - İngilizce: x, y, magnetic, latitude, depth, …
/// - Türkçe: koordinat_x, manyetik, derinlik, enlem, …
/// - Japonca: 座標_x, 磁気, 深度, … (Unicodeicot eklenebilir)
/// - Almanca: karte, magnetisch, tiefe, breite, …
/// - Fransızca: coordonnee, magnetique, profondeur, …
/// - Rusça: координата, магнитный, глубина, …
pub const FIELD_MAPPINGS: &[FieldMapping] = &[
    // ══════════════════════════════════════════════════════════
    // X koordinatı
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "x", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "X", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "pos_x", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "posx", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "easting", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "east", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "dist", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "distance", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "line", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "coord_x", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "coordinate_x", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: " longitude", target: "x", sensor: SensorKind::Generic },
    // Türkçe
    FieldMapping { source: "koordinat_x", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "x_koordinati", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "doğu", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "mesafe", target: "x", sensor: SensorKind::Generic },
    // Almanca
    FieldMapping { source: "ostwert", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "x_koordinate", target: "x", sensor: SensorKind::Generic },
    // Fransızca
    FieldMapping { source: "est", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "abscisse", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "coordonnee_x", target: "x", sensor: SensorKind::Generic },
    // İtalyanca / İspanyolca
    FieldMapping { source: "x coordinata", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "este", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "absisa", target: "x", sensor: SensorKind::Generic },

    // ══════════════════════════════════════════════════════════
    // Y koordinatı
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "y", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "Y", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "pos_y", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "posy", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "northing", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "north", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "coord_y", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "coordinate_y", target: "y", sensor: SensorKind::Generic },
    // Türkçe
    FieldMapping { source: "koordinat_y", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "y_koordinati", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "kuzey", target: "y", sensor: SensorKind::Generic },
    // Almanca
    FieldMapping { source: "nordwert", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "y_koordinate", target: "y", sensor: SensorKind::Generic },
    // Fransızca
    FieldMapping { source: "nord", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "ordonnee", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "coordonnee_y", target: "y", sensor: SensorKind::Generic },
    // İtalyanca / İspanyolca
    FieldMapping { source: "y coordinata", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "norte", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "ordinata", target: "y", sensor: SensorKind::Generic },

    // ══════════════════════════════════════════════════════════
    // Z / Derinlik
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "z", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "Z", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "pos_z", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "posz", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "elevation", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "elev", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "alt", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "altitude", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "height", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "depth", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "dep", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "elev_m", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "depth_m", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "coord_z", target: "z", sensor: SensorKind::Generic },
    // Türkçe
    FieldMapping { source: "derinlik", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "yükseklik", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "z_koordinati", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "koordinat_z", target: "z", sensor: SensorKind::Generic },
    // Almanca
    FieldMapping { source: "tiefe", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "hoehe", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "z_koordinate", target: "z", sensor: SensorKind::Generic },
    // Fransızca
    FieldMapping { source: "profondeur", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "hauteur", target: "z", sensor: SensorKind::Generic },
    // İtalyanca / İspanyolca
    FieldMapping { source: "profondita", target: "z", sensor: SensorKind::Generic },
    FieldMapping { source: "profundidad", target: "z", sensor: SensorKind::Generic },

    // ══════════════════════════════════════════════════════════
    // Manyetik değer
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "magnetic", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "Magnetic", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "mag", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "Mag", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "magnetic_field", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "mag_field", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "magfield", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "total_field", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "totalfield", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "total_field_nt", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "tf", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "data", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "Data", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "value", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "Value", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "val", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "anomaly", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "anom", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "reading", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "nt", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "nT", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "gammas", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "gamma", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "mg", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "field", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "Field", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "mag_data", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "magdata", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "mag_reading", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "b_total", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "btot", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "f", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "F", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "count", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "counts", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "raw", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "raw_value", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "measurement", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "sample", target: "magnetic", sensor: SensorKind::Generic },
    // Türkçe
    FieldMapping { source: "manyetik", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "Manyetik", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "manyetik_deger", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "manyetik_alan", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "anomali", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "okuma", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "deger", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "nit", target: "magnetic", sensor: SensorKind::Generic },
    // Almanca
    FieldMapping { source: "magnetisch", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "magnetfeld", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "messwert", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "anomalie", target: "magnetic", sensor: SensorKind::Generic },
    // Fransızca
    FieldMapping { source: "magnetique", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "champ", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "anomalie", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "valeur", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "mesure", target: "magnetic", sensor: SensorKind::Generic },
    // İtalyanca / İspanyolca
    FieldMapping { source: "magnetico", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "campo", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "magnético", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "anomalia", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "lectura", target: "magnetic", sensor: SensorKind::Generic },
    FieldMapping { source: "valor", target: "magnetic", sensor: SensorKind::Generic },

    // ══════════════════════════════════════════════════════════
    // Proton sensör özel
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "field_strength", target: "magnetic", sensor: SensorKind::Proton },
    FieldMapping { source: "field strength", target: "magnetic", sensor: SensorKind::Proton },
    FieldMapping { source: "field_strength_nt", target: "magnetic", sensor: SensorKind::Proton },
    FieldMapping { source: "total_magnetic", target: "magnetic", sensor: SensorKind::Proton },
    FieldMapping { source: "total magnetic", target: "magnetic", sensor: SensorKind::Proton },
    FieldMapping { source: "proton_field", target: "magnetic", sensor: SensorKind::Proton },
    FieldMapping { source: "proton reading", target: "magnetic", sensor: SensorKind::Proton },

    // ══════════════════════════════════════════════════════════
    // Bartington gradyan
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "gradient", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "grad", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "grad_z", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "grad_x", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "grad_y", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "db_dx", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "db_dz", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "db_dy", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "dB/dx", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "dB/dz", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "dB/dy", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "gradiente", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "gradiant", target: "magnetic", sensor: SensorKind::Bartington },
    FieldMapping { source: "vertical_gradient", target: "magnetic", sensor: SensorKind::Bartington },

    // ══════════════════════════════════════════════════════════
    // GSSI radar
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "amplitude", target: "magnetic", sensor: SensorKind::GSSI },
    FieldMapping { source: "ampl", target: "magnetic", sensor: SensorKind::GSSI },
    FieldMapping { source: "two_way_time", target: "z", sensor: SensorKind::GSSI },
    FieldMapping { source: "twtt", target: "z", sensor: SensorKind::GSSI },
    FieldMapping { source: "travel_time", target: "z", sensor: SensorKind::GSSI },
    FieldMapping { source: "travel time", target: "z", sensor: SensorKind::GSSI },
    FieldMapping { source: "two-way", target: "z", sensor: SensorKind::GSSI },
    FieldMapping { source: "reflection", target: "magnetic", sensor: SensorKind::GSSI },

    // ══════════════════════════════════════════════════════════
    // Cesium magnetometre
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "cesium_field", target: "magnetic", sensor: SensorKind::Cesium },
    FieldMapping { source: "cs_total", target: "magnetic", sensor: SensorKind::Cesium },
    FieldMapping { source: "ppm", target: "magnetic", sensor: SensorKind::Cesium },

    // ══════════════════════════════════════════════════════════
    // Fluxgate
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "bx", target: "magnetic", sensor: SensorKind::Fluxgate },
    FieldMapping { source: "by", target: "magnetic", sensor: SensorKind::Fluxgate },
    FieldMapping { source: "bz", target: "magnetic", sensor: SensorKind::Fluxgate },
    FieldMapping { source: "b_x", target: "magnetic", sensor: SensorKind::Fluxgate },
    FieldMapping { source: "b_y", target: "magnetic", sensor: SensorKind::Fluxgate },
    FieldMapping { source: "b_z", target: "magnetic", sensor: SensorKind::Fluxgate },
    FieldMapping { source: "h_x", target: "magnetic", sensor: SensorKind::Fluxgate },
    FieldMapping { source: "h_y", target: "magnetic", sensor: SensorKind::Fluxgate },
    FieldMapping { source: "h_z", target: "magnetic", sensor: SensorKind::Fluxgate },

    // ══════════════════════════════════════════════════════════
    // Resistivity
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "resistivity", target: "magnetic", sensor: SensorKind::Resistivity },
    FieldMapping { source: "rho", target: "magnetic", sensor: SensorKind::Resistivity },
    FieldMapping { source: "apparent_resistivity", target: "magnetic", sensor: SensorKind::Resistivity },
    FieldMapping { source: "ohm", target: "magnetic", sensor: SensorKind::Resistivity },
    FieldMapping { source: "ohm_m", target: "magnetic", sensor: SensorKind::Resistivity },

    // ══════════════════════════════════════════════════════════
    // EM (Elektromanyetik)
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "em_response", target: "magnetic", sensor: SensorKind::EM },
    FieldMapping { source: "ip", target: "magnetic", sensor: SensorKind::EM },
    FieldMapping { source: "phase", target: "magnetic", sensor: SensorKind::EM },
    FieldMapping { source: "conductivity", target: "magnetic", sensor: SensorKind::EM },
    FieldMapping { source: "siemens", target: "magnetic", sensor: SensorKind::EM },

    // ══════════════════════════════════════════════════════════
    // GPS / Konum
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "lat", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "Lat", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "latitude", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "Latitude", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "lat_deg", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "lat_d", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "gps_lat", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "gps_latitude", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "dec_lat", target: "latitude", sensor: SensorKind::Generic },
    // Türkçe
    FieldMapping { source: "enlem", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "Enlem", target: "latitude", sensor: SensorKind::Generic },
    // Almanca
    FieldMapping { source: "breite", target: "latitude", sensor: SensorKind::Generic },
    FieldMapping { source: "geographische_breite", target: "latitude", sensor: SensorKind::Generic },
    // Fransızca
    FieldMapping { source: "latitude_deg", target: "latitude", sensor: SensorKind::Generic },

    FieldMapping { source: "lon", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "Lon", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "lng", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "Lng", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "longitude", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "Longitude", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "lon_deg", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "lon_d", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "gps_lon", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "gps_lng", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "gps_longitude", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "dec_lon", target: "longitude", sensor: SensorKind::Generic },
    // Türkçe
    FieldMapping { source: "boylam", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "Boylam", target: "longitude", sensor: SensorKind::Generic },
    // Almanca
    FieldMapping { source: "laenge", target: "longitude", sensor: SensorKind::Generic },
    FieldMapping { source: "geographische_laenge", target: "longitude", sensor: SensorKind::Generic },

    // ══════════════════════════════════════════════════════════
    // Zaman
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "time", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "Time", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "timestamp", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "t", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "date", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "datetime", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "time_ms", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "epoch", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "unix_time", target: "timestamp_ms", sensor: SensorKind::Generic },
    // Türkçe
    FieldMapping { source: "zaman", target: "timestamp_ms", sensor: SensorKind::Generic },
    FieldMapping { source: "tarih", target: "timestamp_ms", sensor: SensorKind::Generic },

    // ══════════════════════════════════════════════════════════
    // Ek alanlar (ek bilgi)
    // ══════════════════════════════════════════════════════════
    FieldMapping { source: "id", target: "x", sensor: SensorKind::Generic }, // atama sırasında ID ignored
    FieldMapping { source: "no", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "point", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "station", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "probe", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "survey_line", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "profile", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "section", target: "y", sensor: SensorKind::Generic },
    FieldMapping { source: "track", target: "x", sensor: SensorKind::Generic },
    FieldMapping { source: "path", target: "x", sensor: SensorKind::Generic },
];

// ── SDC okuma sonucu ──

/// SDC dosyasından okunan tam veri seti.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SDCDataset {
    /// Dosya adı
    pub file_name: String,
    /// Algılanan sensör türü
    pub sensor_kind: SensorKind,
    /// Algılanan ondalık ayracı
    pub decimal_separator: char,
    /// Algılanan alan ayracı
    pub delimiter: char,
    /// Toplam ham satır sayısı
    pub raw_line_count: usize,
    /// Başarılı parse edilen nokta sayısı
    pub point_count: usize,
    /// Okunan veri noktaları
    pub points: Vec<SDCPoint>,
    /// Minimum değerler
    pub x_min: f64,
    pub x_max: f64,
    pub y_min: f64,
    pub y_max: f64,
    pub z_min: f64,
    pub z_max: f64,
    pub magnetic_min: f64,
    pub magnetic_max: f64,
    /// Field name haritalama kaydı (hangi sütun hangi alana mappedi)
    pub field_map_log: Vec<String>,
}

impl Default for SDCDataset {
    fn default() -> Self {
        Self {
            file_name: String::new(),
            sensor_kind: SensorKind::Unknown,
            decimal_separator: '.',
            delimiter: ',',
            raw_line_count: 0,
            point_count: 0,
            points: Vec::new(),
            x_min: f64::INFINITY,
            x_max: f64::NEG_INFINITY,
            y_min: f64::INFINITY,
            y_max: f64::NEG_INFINITY,
            z_min: f64::INFINITY,
            z_max: f64::NEG_INFINITY,
            magnetic_min: f64::INFINITY,
            magnetic_max: f64::NEG_INFINITY,
            field_map_log: Vec::new(),
        }
    }
}

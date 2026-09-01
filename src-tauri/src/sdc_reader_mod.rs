//! SDC (Sensor Data Collection) okuma modülü.
//!
//! Çoklu sensör formatından (CSV, Excel, tab-separated, Proton, Bartington, GSSI, Cesium, Fluxgate, Resistivity)
//! ham veriyi standart SDCDataset formuna dönüştürür.
//!
//! Temel özellikler:
//! - `sniff_decimal_in()` — Ondalık ayracı otomatik algılama (nokta mı virgül mü)
//! - Field name haritalama — Sütun adlarını standart alanlara eşleme (Unicode/Türkçe/Almanca/Fransızca)
//! - Sensör türü algılama — SGS-01, Proton, Bartington, GSSI, Cesium, Fluxgate, Resistivity, EM
//! - Esnek ayraç algılama — virgül, noktalı virgül, tab, boşluk, boru
//!
//! # Örnek Kullanım
//!
//! ```ignore
//! use crate::sdc_reader_mod::read_sdc_file;
//!
//! let dataset = read_sdc_file(&csv_content, "veri.csv")?;
//! println!("{} nokta okundu, sensör: {:?}", dataset.point_count, dataset.sensor_kind);
//! ```

use crate::sdc_model::{SDCDataset, SDCPoint, SensorKind, FIELD_MAPPINGS};

// ── sniffDecimalIn ────────────────────────────────────────────

/// Bir metin satırındaki ondalık ayracı algıla.
///
/// Mantık:
/// 1. Ayraca göre bölünen token'lardaki virgül/nokta yapısına bak
/// 2. Virgül sonrası 1-2 basamak → virgül ondalık (Avrupa)
/// 3. Virgül sonrası 3+ basamak → virgül binlik
/// 4. Nokta sonrası 1-3 basamak → nokta ondalık (US)
pub fn sniff_decimal_in(lines: &[&str]) -> char {
    let data_lines: Vec<&str> = lines
        .iter()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with('#') && !t.starts_with("//")
        })
        .take(20)
        .copied()
        .collect();

    if data_lines.is_empty() {
        return '.';
    }

    let first_line = data_lines[0];
    let delim = if first_line.contains('\t') { '\t' }
    else if first_line.contains(';') { ';' }
    else if first_line.contains(',') { ',' }
    else if first_line.contains('|') { '|' }
    else { ' ' };

    let mut comma_as_decimal = 0usize;
    let mut comma_as_thousands = 0usize;
    let mut period_as_decimal = 0usize;
    let mut period_as_thousands = 0usize;

    for line in &data_lines {
        let tokens: Vec<&str> = match delim {
            '\t' => line.split('\t').collect(),
            ';' => line.split(';').collect(),
            '|' => line.split('|').collect(),
            ' ' => line.split_whitespace().collect(),
            _ => line.split(',').collect(),
        };

        for token in &tokens {
            let t = token.trim().trim_matches(|c| c == '\'');
            if t.is_empty() { continue; }
            if t.parse::<f64>().is_ok() { continue; }

            let cleaned: String = t.chars().filter(|c| !c.is_whitespace() && *c != '_').collect();

            if cleaned.contains(',') {
                let chars: Vec<char> = cleaned.chars().collect();
                for (i, &c) in chars.iter().enumerate() {
                    if c != ',' { continue; }
                    let digits_after = chars[i + 1..]
                        .iter()
                        .take_while(|&&ch| ch.is_ascii_digit())
                        .count();
                    if digits_after >= 1 && digits_after <= 2 {
                        comma_as_decimal += 1;
                    } else if digits_after >= 3 {
                        comma_as_thousands += 1;
                    }
                }
            }

            if cleaned.contains('.') {
                let chars: Vec<char> = cleaned.chars().collect();
                for (i, &c) in chars.iter().enumerate() {
                    if c != '.' { continue; }
                    let digits_after = chars[i + 1..]
                        .iter()
                        .take_while(|&&ch| ch.is_ascii_digit())
                        .count();
                    if digits_after >= 1 && digits_after <= 3 {
                        period_as_decimal += 1;
                    } else if digits_after >= 4 {
                        period_as_thousands += 1;
                    }
                }
            }
        }
    }

    if comma_as_decimal > comma_as_thousands && comma_as_decimal > 0 {
        return ',';
    }
    if period_as_decimal > period_as_thousands && period_as_decimal > 0 {
        return '.';
    }
    if delim == ',' {
        return '.';
    }
    if delim == ';' || delim == '|' || delim == '\t' {
        if comma_as_decimal > 0 { return ','; }
    }
    '.'
}

/// CSV satırını f64 değerlerine çevir.
pub fn parse_line_f64(line: &str, decimal_sep: char, delimiter: char) -> Vec<f64> {
    let raw_values: Vec<&str> = match delimiter {
        '\t' => line.split('\t').collect(),
        ';' => line.split(';').collect(),
        ' ' => line.split_whitespace().collect(),
        _ => line.split(delimiter).collect(),
    };

    raw_values
        .iter()
        .filter_map(|s| parse_number_with_decimal(s.trim(), decimal_sep))
        .collect()
}

/// Tek bir sayı string'ini f64'e çevir.
fn parse_number_with_decimal(s: &str, decimal_sep: char) -> Option<f64> {
    let s = s.trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
    if s.is_empty() { return None; }

    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_')
        .collect();

    if cleaned.is_empty() { return None; }

    if decimal_sep == ',' {
        if cleaned.contains(',') && !cleaned.contains('.') {
            let parts: Vec<&str> = cleaned.split(',').collect();
            if parts.len() == 2 && parts[1].len() <= 2 {
                let normalized = format!("{}.{}", parts[0], parts[1]);
                return normalized.parse::<f64>().ok();
            } else {
                let no_commas: String = cleaned.chars().filter(|&c| c != ',').collect();
                return no_commas.parse::<f64>().ok();
            }
        }
        if cleaned.contains(',') && cleaned.contains('.') {
            let last_comma = cleaned.rfind(',');
            let last_period = cleaned.rfind('.');
            if last_comma > last_period {
                let normalized: String = cleaned
                    .chars()
                    .map(|c| if c == '.' { '\0' } else if c == ',' { '.' } else { c })
                    .filter(|&c| c != '\0')
                    .collect();
                return normalized.parse::<f64>().ok();
            } else {
                let no_commas: String = cleaned.chars().filter(|&c| c != ',').collect();
                return no_commas.parse::<f64>().ok();
            }
        }
    } else {
        if cleaned.contains('.') && cleaned.contains(',') {
            let last_comma = cleaned.rfind(',');
            let last_period = cleaned.rfind('.');
            if last_period > last_comma {
                let no_commas: String = cleaned.chars().filter(|&c| c != ',').collect();
                return no_commas.parse::<f64>().ok();
            } else {
                let normalized: String = cleaned
                    .chars()
                    .map(|c| if c == ',' { '.' } else { c })
                    .collect();
                return normalized.parse::<f64>().ok();
            }
        }
        if cleaned.contains(',') && !cleaned.contains('.') {
            let no_commas: String = cleaned.chars().filter(|&c| c != ',').collect();
            return no_commas.parse::<f64>().ok();
        }
    }

    cleaned.parse::<f64>().ok()
}

// ── Unicode yardımcıları ──────────────────────────────────────

/// Unicode normalize edilmiş küçük harfe çevir.
/// Boşluk, tire, alt çizgi, noktalı virgül gibi ayırıcıları standartlaştırır.
fn normalize_column_name(name: &str) -> String {
    name.trim()
        .to_lowercase()
        // Türkçe karakter desteği
        .replace('ğ', "g")
        .replace('ü', "u")
        .replace('ş', "s")
        .replace('ı', "i")
        .replace('ö', "o")
        .replace('ç', "c")
        .replace('İ', "i")
        .replace('Ğ', "g")
        .replace('Ü', "u")
        .replace('Ş', "s")
        .replace('Ö', "o")
        .replace('Ç', "c")
        // Almanca/Fransızca karakter
        .replace('ä', "ae")
        .replace('ö', "oe")
        .replace('ü', "ue")
        .replace('ß', "ss")
        .replace('é', "e")
        .replace('è', "e")
        .replace('ê', "e")
        .replace('ë', "e")
        .replace('à', "a")
        .replace('â', "a")
        .replace('î', "i")
        .replace('ï', "i")
        .replace('ô', "o")
        .replace('ù', "u")
        .replace('û', "u")
        .replace('ñ', "n")
        // Ayraç standartlaştırma — tire, alt çizgi, boşluk, nokta, parantez, virgül
        .replace(|c: char| c == '-' || c == '_' || c == ' ' || c == '.' || c == '(' || c == ')' || c == ',' || c == '/', "")
}

// ── Sensör türü algılama ─────────────────────────────────────

/// Başlık satırlarından sensör türünü algıla.
/// Unicode/Türkçe destekli.
fn detect_sensor_kind(header_line: &str) -> SensorKind {
    let lower = normalize_column_name(header_line);

    // Proton magnetometre belirteçleri (Cesium'dan ÖNCE kontrol et)
    if lower.contains("proton")
        || lower.contains("precession")
        || lower.contains("fieldstrength")
        || lower.contains("totalfield")
        || lower.contains("totalmagnetic")
    {
        return SensorKind::Proton;
    }

    // Bartington gradyan belirteçleri
    if lower.contains("bartington")
        || lower.contains("grad")
        || lower.contains("gradiant")
        || lower.contains("gradiente")
        || lower.contains("dbdx")
        || lower.contains("dbdz")
        || lower.contains("dbdy")
        || lower.contains("db/dx")
        || lower.contains("db/dz")
        || lower.contains("grad01")
        || lower.contains("verticalgradient")
    {
        return SensorKind::Bartington;
    }

    // GSSI radar belirteçleri
    if lower.contains("gssi")
        || lower.contains("twoway")
        || lower.contains("twtt")
        || lower.contains("traveltime")
        || lower.contains("radar")
        || lower.contains("amplitude")
        || lower.contains("reflection")
    {
        return SensorKind::GSSI;
    }

    // Cesium belirteçleri
    if lower.contains("cesium")
        || lower.contains("geometrics")
        || lower.contains("santem")
        || lower.contains("cs_total")
        || lower.contains("ppm")
    {
        return SensorKind::Cesium;
    }

    // Fluxgate belirteçleri
    if lower.contains("fluxgate")
        || lower.contains("bh") // bx, by, bz + h
        || (lower.contains("bx") && lower.contains("bz"))
    {
        return SensorKind::Fluxgate;
    }

    // Resistivity belirteçleri
    if lower.contains("resistivity")
        || lower.contains("ohm")
        || lower.contains("rho")
        || lower.contains("apparent")
    {
        return SensorKind::Resistivity;
    }

    // EM belirteçleri
    if lower.contains("em_response")
        || lower.contains("conductivity")
        || lower.contains("siemens")
        || lower.contains("phase")
        || lower.contains("induction")
    {
        return SensorKind::EM;
    }

    // SGS-01 belirteçleri
    if lower.contains("sgs")
        || lower.contains("votex")
        || lower.contains("manyetik")
        || lower.contains("magnetik")
    {
        return SensorKind::SGS01;
    }

    SensorKind::Generic
}

// ── Alan ayracı algılama ──────────────────────────────────────

fn detect_delimiter(line: &str) -> char {
    if line.contains('\t') { '\t' }
    else if line.contains(';') { ';' }
    else if line.contains(',') { ',' }
    else if line.contains('|') { '|' }
    else { ' ' }
}

// ── Field name haritalama ─────────────────────────────────────

/// Başlık satırındaki sütun adlarını SDCPoint alanlarına eşle.
/// Unicode normalizasyonu ile dil bağımsız eşleştirme yapar.
fn map_field_names(
    header_columns: &[String],
    sensor_kind: SensorKind,
) -> (std::collections::HashMap<String, usize>, Vec<String>) {
    let mut field_indices: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut log: Vec<String> = Vec::new();

    let target_fields = ["x", "y", "z", "magnetic", "latitude", "longitude", "timestamp_ms"];

    for target in &target_fields {
        let mut best_match: Option<(usize, &str)> = None;

        for (col_idx, col_name) in header_columns.iter().enumerate() {
            let col_normalized = normalize_column_name(col_name);

            // 1. Sensöre özel mapping dene
            for mapping in FIELD_MAPPINGS.iter() {
                if mapping.target == *target && mapping.sensor == sensor_kind {
                    let src_normalized = normalize_column_name(mapping.source);
                    if col_normalized == src_normalized {
                        best_match = Some((col_idx, mapping.source));
                        break;
                    }
                }
            }
            if best_match.is_some() { break; }

            // 2. Generic mapping dene
            for mapping in FIELD_MAPPINGS.iter() {
                if mapping.target == *target && mapping.sensor == SensorKind::Generic {
                    let src_normalized = normalize_column_name(mapping.source);
                    if col_normalized == src_normalized {
                        best_match = Some((col_idx, mapping.source));
                        break;
                    }
                }
            }
            if best_match.is_some() { break; }

            // 3. Kısmi eşleşme — sütun adı mapping source'un içinde mi? (ör: "Field Strength (nT)" → "field_strength")
            if best_match.is_none() {
                for mapping in FIELD_MAPPINGS.iter() {
                    if mapping.target == *target {
                        let src_normalized = normalize_column_name(mapping.source);
                        if src_normalized.len() >= 3 && col_normalized.contains(&src_normalized) {
                            best_match = Some((col_idx, mapping.source));
                            break;
                        }
                    }
                }
            }
            if best_match.is_some() { break; }
        }

        if let Some((idx, source)) = best_match {
            field_indices.insert(target.to_string(), idx);
            log.push(format!("'{}' → {}", source, target));
        }
    }

    // Sayısal başlık varsa ve henüz x/y atanmadıysa → pozisyona göre ata
    if !field_indices.contains_key("x") && !field_indices.contains_key("y") {
        let all_numeric = header_columns.iter().all(|h| {
            h.trim().parse::<f64>().is_ok() || h.trim().is_empty()
        });
        if all_numeric || header_columns.iter().any(|h| h.trim().parse::<f64>().is_ok()) {
            if header_columns.len() >= 3 {
                field_indices.entry("x".to_string()).or_insert(0);
                field_indices.entry("y".to_string()).or_insert(1);
                field_indices.entry("z".to_string()).or_insert(2);
                log.push("Sayısal sırada: sütun 0→x, 1→y, 2→z".to_string());
            }
            if header_columns.len() >= 4 {
                field_indices.entry("magnetic".to_string()).or_insert(3);
                log.push("Sayısal sırada: sütun 3→magnetic".to_string());
            }
        }
    }

    (field_indices, log)
}

// ── Başlık algılama ───────────────────────────────────────────

/// İlk satırın başlık olup olmadığını kontrol et.
/// Unicode/Türkçe destekli anahtar kelime listesi.
fn is_header_line(line: &str) -> bool {
    let trimmed = line.trim();

    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
        return false;
    }

    let lower = normalize_column_name(trimmed);

    // Genişletilmiş başlık anahtar kelimeleri (İngilizce + Türkçe + Almanca + Fransızca)
    let keywords = [
        // Koordinatlar
        "x", "y", "z", "pos", "coord", "easting", "northing", "elevation",
        "east", "north", "alt", "dep", "dist", "line",
        "koordinat", "dogu", "kuzey", "yukseklik", "derinlik", "mesafe",
        "ostwert", "nordwert", "tiefe", "hoehe",
        "est", "nord", "hauteur", "profondeur", "abscisse", "ordonnee",
        // Manyetik
        "mag", "magnetic", "data", "value", "reading", "nt", "anomaly",
        "field", "gammas", "gamma", "count", "raw", "measurement", "sample",
        "manyetik", "anomali", "okuma", "deger", "nit",
        "magnetisch", "messwert", "anomalie",
        "magnetique", "champ", "valeur", "mesure",
        "magnetico", "campo", "anomalia", "lectura", "valor",
        // GPS
        "lat", "lon", "lng", "latitude", "longitude", "gps",
        "enlem", "boylam",
        "breite", "laenge",
        // Zaman
        "time", "timestamp", "date", "datetime", "epoch",
        "zaman", "tarih",
        // Sensör
        "proton", "bartington", "gssi", "radar", "gradient",
        "amplitude", "travel", "two", "way",
        "fluxgate", "resistivity", "ohm", "conductivity",
        // Genel
        "id", "no", "station", "probe", "track", "path",
        "survey", "profile", "section",
    ];

    for kw in &keywords {
        if lower.split(|c: char| c == ',' || c == ';' || c == '\t' || c == ' ' || c == '|')
            .any(|part| part.trim() == *kw)
        {
            return true;
        }
    }

    // Eğer satırda hiç sayı yoksa → muhtemelen başlık
    let has_number = lower
        .split(|c: char| c == ',' || c == ';' || c == '\t' || c == ' ' || c == '|')
        .any(|part| part.trim().parse::<f64>().is_ok());

    !has_number
}

// ── Satır filtreleme ──────────────────────────────────────────

fn is_data_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() { return false; }
    if trimmed.starts_with('#') { return false; }
    if trimmed.starts_with("//") { return false; }
    if trimmed.starts_with("//--") { return false; }
    if trimmed.starts_with("---") { return false; }

    let numeric_count = trimmed
        .split(|c: char| c == ',' || c == ';' || c == '\t' || c == ' ' || c == '|')
        .filter(|s| {
            let t = s.trim();
            !t.is_empty() && t.parse::<f64>().is_ok()
        })
        .count();

    numeric_count >= 3
}

// ── Ana okuma fonksiyonu ──────────────────────────────────────

/// SDC dosyasını oku ve SDCDataset olarak döndür.
pub fn read_sdc_file(content: &str, file_name: &str) -> Result<SDCDataset, String> {
    let all_lines: Vec<&str> = content.lines().collect();

    if all_lines.is_empty() {
        return Err("Dosya boş".into());
    }

    // 1. Ondalık ayracını algıla
    let sample_lines: Vec<&str> = all_lines
        .iter()
        .filter(|l| is_data_line(l))
        .take(10)
        .copied()
        .collect();

    let decimal_sep = if sample_lines.is_empty() {
        '.'
    } else {
        sniff_decimal_in(&sample_lines)
    };

    // 2. Alan ayracını algıla
    let first_data_line = all_lines
        .iter()
        .find(|l| is_data_line(l) || is_header_line(l))
        .unwrap_or(&all_lines[0]);
    let delimiter = detect_delimiter(first_data_line);

    // 3. Sensör türünü algıla
    let header_line = all_lines
        .iter()
        .find(|l| is_header_line(l))
        .map(|s| *s)
        .unwrap_or("");
    let sensor_kind = detect_sensor_kind(header_line);

    // 4. Başlık satırını ayrıştır ve field name haritalama yap
    let mut field_indices: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut field_map_log: Vec<String> = Vec::new();
    let mut data_start_idx = 0;

    if is_header_line(header_line) {
        let header_cols: Vec<String> = match delimiter {
            '\t' => header_line.split('\t').map(|s| s.trim().to_string()).collect(),
            ';' => header_line.split(';').map(|s| s.trim().to_string()).collect(),
            '|' => header_line.split('|').map(|s| s.trim().to_string()).collect(),
            ' ' => header_line.split_whitespace().map(|s| s.to_string()).collect(),
            _ => header_line.split(',').map(|s| s.trim().to_string()).collect(),
        };

        let (indices, log) = map_field_names(&header_cols, sensor_kind);
        field_indices = indices;
        field_map_log = log;

        data_start_idx = all_lines.iter().position(|l| *l == header_line).unwrap_or(0) + 1;
    }

    // 5. Varsayılan alan eşlemesi
    if !field_indices.contains_key("x") {
        field_indices.insert("x".to_string(), 0);
        field_map_log.push("Varsayılan: sütun 0 → x".to_string());
    }
    if !field_indices.contains_key("y") {
        field_indices.insert("y".to_string(), 1);
        field_map_log.push("Varsayılan: sütun 1 → y".to_string());
    }
    if !field_indices.contains_key("z") && field_indices.contains_key("magnetic") {
        let mag_idx = *field_indices.get("magnetic").unwrap_or(&3);
        if mag_idx >= 3 {
            field_indices.insert("z".to_string(), mag_idx - 1);
            field_map_log.push(format!("Tahmini: sütun {} → z (magnetic öncesi)", mag_idx - 1));
        }
    }
    if !field_indices.contains_key("z") {
        field_indices.insert("z".to_string(), 2);
        field_map_log.push("Varsayılan: sütun 2 → z".to_string());
    }
    if !field_indices.contains_key("magnetic") {
        let last_idx = field_indices.values().copied().max().unwrap_or(2).max(3);
        field_indices.insert("magnetic".to_string(), last_idx);
        field_map_log.push(format!("Varsayılan: sütun {} → magnetic", last_idx));
    }

    // 6. Veri satırlarını oku
    let mut points: Vec<SDCPoint> = Vec::new();
    let mut raw_line_count = 0usize;

    for line in &all_lines[data_start_idx..] {
        raw_line_count += 1;

        if !is_data_line(line) {
            continue;
        }

        let values = parse_line_f64(line, decimal_sep, delimiter);
        if values.is_empty() {
            continue;
        }

        let get = |field: &str| -> f64 {
            field_indices
                .get(field)
                .and_then(|&idx| values.get(idx).copied())
                .unwrap_or(0.0)
        };

        let get_opt = |field: &str| -> Option<f64> {
            field_indices
                .get(field)
                .and_then(|&idx| values.get(idx).copied())
        };

        let x = get("x");
        let y = get("y");
        let z = get("z");
        let magnetic = get("magnetic");

        if x == 0.0 && y == 0.0 && magnetic == 0.0 {
            continue;
        }

        points.push(SDCPoint {
            x,
            y,
            z,
            magnetic,
            raw_value: None,
            timestamp_ms: get_opt("timestamp_ms").map(|v| v as u64),
            latitude: get_opt("latitude"),
            longitude: get_opt("longitude"),
        });
    }

    if points.is_empty() {
        return Err(format!(
            "Geçerli veri noktası ayrıştırılamadı ({} ham satır okundu)",
            raw_line_count
        ));
    }

    // 7. İstatistikleri hesapla
    let mut x_min = f64::INFINITY;
    let mut x_max = f64::NEG_INFINITY;
    let mut y_min = f64::INFINITY;
    let mut y_max = f64::NEG_INFINITY;
    let mut z_min = f64::INFINITY;
    let mut z_max = f64::NEG_INFINITY;
    let mut magnetic_min = f64::INFINITY;
    let mut magnetic_max = f64::NEG_INFINITY;

    for p in &points {
        if p.x < x_min { x_min = p.x; }
        if p.x > x_max { x_max = p.x; }
        if p.y < y_min { y_min = p.y; }
        if p.y > y_max { y_max = p.y; }
        if p.z < z_min { z_min = p.z; }
        if p.z > z_max { z_max = p.z; }
        if p.magnetic < magnetic_min { magnetic_min = p.magnetic; }
        if p.magnetic > magnetic_max { magnetic_max = p.magnetic; }
    }

    Ok(SDCDataset {
        file_name: file_name.to_string(),
        sensor_kind,
        decimal_separator: decimal_sep,
        delimiter,
        raw_line_count,
        point_count: points.len(),
        points,
        x_min,
        x_max,
        y_min,
        y_max,
        z_min,
        z_max,
        magnetic_min,
        magnetic_max,
        field_map_log,
    })
}

// ── Testler ───────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Mevcut testler ──

    #[test]
    fn sniff_decimal_us_format() {
        let lines = vec!["12.34,56.78,0.5,123.4", "23.45,67.89,0.6,234.5"];
        assert_eq!(sniff_decimal_in(&lines), '.');
    }

    #[test]
    fn sniff_decimal_european_format() {
        let lines = vec!["12,34;56,78;0,5;123,4", "23,45;67,89;0,6;234,5"];
        assert_eq!(sniff_decimal_in(&lines), ',');
    }

    #[test]
    fn sniff_decimal_thousands_separator_tab_delimited() {
        let lines = vec!["1,234,567\t2,345,678"];
        assert_eq!(sniff_decimal_in(&lines), '.');
    }

    #[test]
    fn parse_us_number() {
        let v = parse_number_with_decimal("12.34", '.');
        assert!((v.unwrap() - 12.34).abs() < 0.001);
    }

    #[test]
    fn parse_european_number() {
        let v = parse_number_with_decimal("12,34", ',');
        assert!((v.unwrap() - 12.34).abs() < 0.001);
    }

    #[test]
    fn parse_thousands_with_period_decimal() {
        let v = parse_number_with_decimal("1,234.56", '.');
        assert!((v.unwrap() - 1234.56).abs() < 0.001);
    }

    #[test]
    fn parse_thousands_with_comma_decimal() {
        let v = parse_number_with_decimal("1.234,56", ',');
        assert!((v.unwrap() - 1234.56).abs() < 0.001);
    }

    #[test]
    fn parse_plain_integer() {
        let v = parse_number_with_decimal("1234", '.');
        assert!((v.unwrap() - 1234.0).abs() < 0.001);
    }

    #[test]
    fn parse_negative_number() {
        let v = parse_number_with_decimal("-12.34", '.');
        assert!((v.unwrap() - (-12.34)).abs() < 0.001);
    }

    #[test]
    fn read_simple_csv() {
        let csv = "x,y,z,magnetic\n10,20,0.5,123.4\n30,40,0.6,234.5\n";
        let result = read_sdc_file(csv, "test.csv").unwrap();
        assert_eq!(result.point_count, 2);
        assert_eq!(result.decimal_separator, '.');
        assert_eq!(result.sensor_kind, SensorKind::Generic);
    }

    #[test]
    fn read_european_csv() {
        let csv = "x;y;z;mag\n10;20;0,5;123,4\n30;40;0,6;234,5\n";
        let result = read_sdc_file(csv, "test.csv").unwrap();
        assert_eq!(result.point_count, 2);
        assert_eq!(result.decimal_separator, ',');
        assert_eq!(result.delimiter, ';');
    }

    #[test]
    fn read_tab_separated() {
        let csv = "x\ty\tz\tmagnetic\n10\t20\t0.5\t123.4\n30\t40\t0.6\t234.5\n";
        let result = read_sdc_file(csv, "test.tsv").unwrap();
        assert_eq!(result.point_count, 2);
        assert_eq!(result.delimiter, '\t');
    }

    #[test]
    fn read_proton_format() {
        let csv = "X;Y;Z;Field Strength (nT)\n10;20;0.5;52340.1\n30;40;0.6;52341.2\n";
        let result = read_sdc_file(csv, "proton.csv").unwrap();
        assert_eq!(result.point_count, 2);
        assert_eq!(result.sensor_kind, SensorKind::Proton);
    }

    #[test]
    fn read_without_header() {
        let csv = "10,20,0.5,123.4\n30,40,0.6,234.5\n";
        let result = read_sdc_file(csv, "data.csv").unwrap();
        assert_eq!(result.point_count, 2);
    }

    #[test]
    fn read_with_comments() {
        let csv = "# Bu bir yorum satırı\n// Bu da bir yorum\nx,y,z,magnetic\n10,20,0.5,123.4\n";
        let result = read_sdc_file(csv, "test.csv").unwrap();
        assert_eq!(result.point_count, 1);
    }

    #[test]
    fn field_name_mapping_bartington() {
        let csv = "easting;northing;depth;gradient\n10;20;0.5;123.4\n";
        let result = read_sdc_file(csv, "bart.csv").unwrap();
        assert_eq!(result.sensor_kind, SensorKind::Bartington);
        assert_eq!(result.point_count, 1);
    }

    #[test]
    fn detect_comma_delimiter() {
        assert_eq!(detect_delimiter("a,b,c"), ',');
        assert_eq!(detect_delimiter("a;b;c"), ';');
        assert_eq!(detect_delimiter("a\tb\tc"), '\t');
        assert_eq!(detect_delimiter("a|b|c"), '|');
    }

    // ── Yeni Unicode/Türkçe testleri ──

    #[test]
    fn normalize_turkish_column() {
        assert_eq!(normalize_column_name("Manyetik Değer"), "manyetikdeger");
        assert_eq!(normalize_column_name("Koordinat X"), "koordinatx");
        assert_eq!(normalize_column_name("Derinlik (m)"), "derinlikm");
    }

    #[test]
    fn read_turkish_headers() {
        let csv = "koordinat_x;koordinat_y;derinlik;manyetik\n10;20;0.5;123.4\n30;40;0.6;234.5\n";
        let result = read_sdc_file(csv, "turkce.csv").unwrap();
        assert_eq!(result.point_count, 2);
        // x ve y Türkçe başlıklardan eşleşmeli
        let pt = &result.points[0];
        assert!((pt.x - 10.0).abs() < 0.01);
        assert!((pt.y - 20.0).abs() < 0.01);
        assert!((pt.magnetic - 123.4).abs() < 0.01);
    }

    #[test]
    fn read_english_headers() {
        let csv = "easting;northing;depth;magnetic\n10;20;0.5;123.4\n";
        let result = read_sdc_file(csv, "english.csv").unwrap();
        assert_eq!(result.point_count, 1);
        assert!((result.points[0].x - 10.0).abs() < 0.01);
        assert!((result.points[0].y - 20.0).abs() < 0.01);
    }

    #[test]
    fn read_german_headers() {
        let csv = "ostwert;nordwert;tiefe;magnetisch\n10;20;0.5;123.4\n";
        let result = read_sdc_file(csv, "deutsch.csv").unwrap();
        assert_eq!(result.point_count, 1);
        assert!((result.points[0].x - 10.0).abs() < 0.01);
        assert!((result.points[0].y - 20.0).abs() < 0.01);
    }

    #[test]
    fn read_french_headers() {
        let csv = "est;nord;profondeur;magnetique\n10;20;0.5;123.4\n";
        let result = read_sdc_file(csv, "francais.csv").unwrap();
        assert_eq!(result.point_count, 1);
        assert!((result.points[0].x - 10.0).abs() < 0.01);
    }

    #[test]
    fn read_bartington_gradient() {
        let csv = "easting;northing;depth;dB/dx\n10;20;0.5;123.4\n";
        let result = read_sdc_file(csv, "bart.csv").unwrap();
        assert_eq!(result.sensor_kind, SensorKind::Bartington);
        assert!((result.points[0].magnetic - 123.4).abs() < 0.01);
    }

    #[test]
    fn read_fluxgate_headers() {
        let csv = "bx;by;bz\ntime\n10;20;30;50001\n40;50;60;50002\n";
        let result = read_sdc_file(csv, "flux.csv").unwrap();
        assert_eq!(result.sensor_kind, SensorKind::Fluxgate);
    }

    #[test]
    fn read_resistivity_headers() {
        let csv = "easting;northing;depth;resistivity\n10;20;0.5;45.6\n";
        let result = read_sdc_file(csv, "res.csv").unwrap();
        assert_eq!(result.sensor_kind, SensorKind::Resistivity);
    }

    #[test]
    fn read_gps_lat_lon() {
        let csv = "lat;lon;mag\n41.0082;28.9784;52340.1\n41.0083;28.9785;52341.2\n";
        let result = read_sdc_file(csv, "gps.csv").unwrap();
        assert_eq!(result.point_count, 2);
        let pt = &result.points[0];
        assert!(pt.latitude.is_some());
        assert!(pt.longitude.is_some());
        assert!((pt.latitude.unwrap() - 41.0082).abs() < 0.001);
    }

    #[test]
    fn read_with_spaces_in_values() {
        let csv = "x,y,z,magnetic\n10,20,0.5,123.4\n30,40,0.6,234.5\n";
        let result = read_sdc_file(csv, "space.csv").unwrap();
        assert_eq!(result.point_count, 2);
    }

    #[test]
    fn unicode_column_partial_match() {
        // "Field Strength (nT)" should match "field_strength" via partial match
        let csv = "X;Y;Z;Field Strength (nT)\n10;20;0.5;52340.1\n";
        let result = read_sdc_file(csv, "partial.csv").unwrap();
        assert_eq!(result.sensor_kind, SensorKind::Proton);
        assert!((result.points[0].magnetic - 52340.1).abs() < 0.1);
    }

    #[test]
    fn detect_cesium_sensor() {
        let header = "easting;northing;depth;cesium_field";
        assert_eq!(detect_sensor_kind(header), SensorKind::Cesium);
    }

    #[test]
    fn detect_em_sensor() {
        let header = "x;y;z;conductivity";
        assert_eq!(detect_sensor_kind(header), SensorKind::EM);
    }
}

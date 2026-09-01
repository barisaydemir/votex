//! CSV data import — piksel koordinatları + manyetik sensör değerlerinden 3D yüzey oluşturma.
//!
//! CSV formatı: x,y,z,magnetic (ilk satır başlık olabilir)
//! - x, y: Koordinatlar (piksel veya 3D scanner koordinatı)
//! - z: Derinlik koordinatı (opsiyonel)
//! - magnetic: Manyetik sensör okuma değeri
//!
//! Desteklenen formatlar:
//! - Normal virgül ayracı: `10,20,0.5,123.4`
//! - Binlik ayraçlı: `369,887,300` (virgül binlik ayracı, boşluk sütun ayracı)
//! - Tab ile ayrılmış
//! - Noktalı virgül ile ayrılmış

use serde::{Deserialize, Serialize};
use calamine::{open_workbook_auto, Data, Reader};

/// CSV'den okunan tek bir veri noktası.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvDataPoint {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub magnetic: f32,
}

/// CSV import sonucu — Surface3D'ye dönüştürülmüş veri.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportResult {
    pub points: Vec<CsvDataPoint>,
    pub point_count: usize,
    pub x_min: f32,
    pub x_max: f32,
    pub y_min: f32,
    pub y_max: f32,
    pub z_min: f32,
    pub z_max: f32,
    pub magnetic_min: f32,
    pub magnetic_max: f32,
    pub grid_w: u32,
    pub grid_h: u32,
}

/// Tek satırı f32 değerlerine çevir.
/// Binlik ayraçları (369,887,300) otomatik algılar.
fn parse_line_values(line: &str) -> Vec<f32> {
    // Tab ile ayrılmış
    if line.contains('\t') {
        return line
            .split('\t')
            .filter_map(|s| {
                let cleaned = s.trim().replace(',', "");
                cleaned.parse::<f32>().ok()
            })
            .collect();
    }

    // Noktalı virgül ile ayrılmış
    if line.contains(';') {
        return line
            .split(';')
            .filter_map(|s| {
                let cleaned = s.trim().replace(',', "");
                cleaned.parse::<f32>().ok()
            })
            .collect();
    }

    // Virgül ile ayrılmış — binlik ayraç kontrolü
    let comma_count = line.matches(',').count();
    if comma_count > 3 {
        // Binlik ayraçlı: virgülleri kaldır, sonra boşlukla ayır
        let cleaned = line.replace(',', "");
        return cleaned
            .split(|c: char| c.is_whitespace())
            .filter_map(|s| s.trim().parse::<f32>().ok())
            .collect();
    }

    // Normal virgül ayracı — binlik ayraç yok
    line.split(',')
        .filter_map(|s| s.trim().parse::<f32>().ok())
        .collect()
}

/// CSV içeriğini analiz et ve veri noktalarını çıkar.
pub fn parse_csv(content: &str) -> Result<CsvImportResult, String> {
    let mut points = Vec::new();
    let mut has_header = false;

    for (line_num, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // İlk satır başlık kontrolü — büyük/küçük harf duyarsız
        if line_num == 0 && !has_header {
            let lower = line.to_lowercase();
            if (lower.contains("x") && lower.contains("y"))
                || (lower.contains("data") && lower.contains("magnetic"))
            {
                has_header = true;
                continue;
            }
        }

        let values = parse_line_values(line);

        if values.len() < 3 {
            continue; // En az x, y, magnetic gerekli
        }

        let point = CsvDataPoint {
            x: values[0],
            y: values[1],
            z: if values.len() > 3 { values[2] } else { 0.0 },
            magnetic: if values.len() > 3 { values[3] } else { values[2] },
        };

        points.push(point);
    }

    if points.is_empty() {
        return Err("CSV'de geçerli veri noktası bulunamadı".into());
    }

    // İstatistikleri hesapla
    let point_count = points.len();
    let x_min = points.iter().map(|p| p.x).fold(f32::INFINITY, f32::min);
    let x_max = points.iter().map(|p| p.x).fold(f32::NEG_INFINITY, f32::max);
    let y_min = points.iter().map(|p| p.y).fold(f32::INFINITY, f32::min);
    let y_max = points.iter().map(|p| p.y).fold(f32::NEG_INFINITY, f32::max);
    let z_min = points.iter().map(|p| p.z).fold(f32::INFINITY, f32::min);
    let z_max = points.iter().map(|p| p.z).fold(f32::NEG_INFINITY, f32::max);
    let magnetic_min = points
        .iter()
        .map(|p| p.magnetic)
        .fold(f32::INFINITY, f32::min);
    let magnetic_max = points
        .iter()
        .map(|p| p.magnetic)
        .fold(f32::NEG_INFINITY, f32::max);

    // Grid boyutunu tahmin et
    let grid_w = ((x_max - x_min).abs().ceil() as u32).max(8).min(512);
    let grid_h = ((y_max - y_min).abs().ceil() as u32).max(8).min(512);

    Ok(CsvImportResult {
        points,
        point_count,
        x_min,
        x_max,
        y_min,
        y_max,
        z_min,
        z_max,
        magnetic_min,
        magnetic_max,
        grid_w,
        grid_h,
    })
}

/// Excel (.xlsx) dosyasını oku ve CsvImportResult'a dönüştür.
/// Geçici dosyaya yazıp calamine ile okur.
pub fn parse_excel(content: &[u8]) -> Result<CsvImportResult, String> {
    use std::io::Write;
    
    // Geçici dosyaya yaz (calamine path istiyor)
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("votex_excel_{}.xlsx", std::process::id()));
    
    let mut temp_file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Geçici dosya oluşturulamadı: {e}"))?;
    temp_file.write_all(content)
        .map_err(|e| format!("Geçici dosya yazılamadı: {e}"))?;
    drop(temp_file);
    
    // Calamine ile oku
    let mut workbook = open_workbook_auto(&temp_path)
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("Excel dosyası açılamadı: {e}")
        })?;

    // İlk sayfayı al
    let sheet_name = workbook.sheet_names()
        .first()
        .cloned()
        .ok_or("Excel dosyasında sayfa bulunamadı")?;

    let range = workbook.worksheet_range(&sheet_name)
        .map_err(|e| format!("Sayfa okunamadı: {e}"))?;

    let mut points = Vec::new();

    for (r_idx, row) in range.rows().enumerate() {
        if r_idx == 0 {
            let is_header = row.iter().any(|cell| match cell {
                Data::String(s) => {
                    let lower = s.trim().to_lowercase();
                    lower.contains("x") || lower.contains("y") || lower.contains("z") || lower.contains("data") || lower.contains("magnetic") || lower.contains("sensor")
                }
                _ => false,
            });
            if is_header {
                continue;
            }
        }

        let mut row_vals = Vec::new();
        for cell in row {
            match cell {
                Data::Float(f) => row_vals.push(*f as f32),
                Data::Int(i) => row_vals.push(*i as f32),
                Data::String(s) => {
                    let cleaned = s.trim().replace(',', ".");
                    if let Ok(v) = cleaned.parse::<f32>() {
                        row_vals.push(v);
                    }
                }
                _ => {}
            }
        }

        if row_vals.len() < 3 {
            continue;
        }

        let point = CsvDataPoint {
            x: row_vals[0],
            y: row_vals[1],
            z: if row_vals.len() > 3 { row_vals[2] } else { 0.0 },
            magnetic: if row_vals.len() > 3 { row_vals[3] } else { row_vals[2] },
        };

        points.push(point);
    }

    if points.is_empty() {
        return Err("Excel dosyasında geçerli veri noktası bulunamadı".into());
    }

    let point_count = points.len();
    let x_min = points.iter().map(|p| p.x).fold(f32::INFINITY, f32::min);
    let x_max = points.iter().map(|p| p.x).fold(f32::NEG_INFINITY, f32::max);
    let y_min = points.iter().map(|p| p.y).fold(f32::INFINITY, f32::min);
    let y_max = points.iter().map(|p| p.y).fold(f32::NEG_INFINITY, f32::max);
    let z_min = points.iter().map(|p| p.z).fold(f32::INFINITY, f32::min);
    let z_max = points.iter().map(|p| p.z).fold(f32::NEG_INFINITY, f32::max);
    let magnetic_min = points.iter().map(|p| p.magnetic).fold(f32::INFINITY, f32::min);
    let magnetic_max = points.iter().map(|p| p.magnetic).fold(f32::NEG_INFINITY, f32::max);
    let grid_w = ((x_max - x_min).abs().ceil() as u32).max(8).min(512);
    let grid_h = ((y_max - y_min).abs().ceil() as u32).max(8).min(512);

    let result = CsvImportResult {
        points,
        point_count,
        x_min,
        x_max,
        y_min,
        y_max,
        z_min,
        z_max,
        magnetic_min,
        magnetic_max,
        grid_w,
        grid_h,
    };
    
    // Geçici dosyayı temizle
    let _ = std::fs::remove_file(&temp_path);
    
    Ok(result)
}

/// Dosya uzantısına göre CSV veya Excel olarak oku.
pub fn parse_data_file(content: &str, file_name: &str) -> Result<CsvImportResult, String> {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".xlsx") || lower.ends_with(".xls") {
        // Excel dosyası — binary olarak okunmalı
        Err("Excel dosyası binary olarak okunmalı - pickExcelFile kullanın".into())
    } else {
        // CSV/TSV/TXT
        parse_csv(content)
    }
}

/// Excel bytes'larını parse et.
pub fn parse_excel_bytes(bytes: &[u8]) -> Result<CsvImportResult, String> {
    parse_excel(bytes)
}

/// CSV verisini signed field'e dönüştür.
pub fn csv_to_signed_field(
    points: &[CsvDataPoint],
    grid_w: u32,
    grid_h: u32,
    x_min: f32,
    x_max: f32,
    y_min: f32,
    y_max: f32,
    magnetic_min: f32,
    magnetic_max: f32,
) -> (Vec<f32>, Vec<u8>) {
    let n = (grid_w * grid_h) as usize;
    let mut signed_field = vec![0.0f32; n];
    let mut colors = vec![0u8; n * 3];
    let mut counts = vec![0u32; n];

    let x_range = (x_max - x_min).abs().max(1.0);
    let y_range = (y_max - y_min).abs().max(1.0);
    let m_range = (magnetic_max - magnetic_min).abs().max(1.0);

    for point in points {
        let nx = (point.x - x_min) / x_range;
        let ny = (point.y - y_min) / y_range;
        let gx = (nx * (grid_w - 1) as f32).round() as i32;
        let gy = (ny * (grid_h - 1) as f32).round() as i32;

        if gx < 0 || gy < 0 || gx >= grid_w as i32 || gy >= grid_h as i32 {
            continue;
        }

        let idx = (gy as u32 * grid_w + gx as u32) as usize;
        let normalized = 2.0 * (point.magnetic - magnetic_min) / m_range - 1.0;
        signed_field[idx] += normalized;
        counts[idx] += 1;

        let (r, g, b) = magnetic_to_rgb(point.magnetic, magnetic_min, magnetic_max);
        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;
    }

    for i in 0..n {
        if counts[i] > 0 {
            signed_field[i] /= counts[i] as f32;
        }
    }

    (signed_field, colors)
}

/// Manyetik değeri RGB renge dönüştür.
fn magnetic_to_rgb(value: f32, min: f32, max: f32) -> (u8, u8, u8) {
    let range = (max - min).abs().max(1.0);
    let t = (value - min) / range;

    if t < 0.3 {
        let intensity = (t / 0.3) as f32;
        let r = (20.0 + intensity * 40.0) as u8;
        let g = (60.0 + intensity * 80.0) as u8;
        let b = (180.0 + intensity * 75.0) as u8;
        (r, g, b)
    } else if t < 0.5 {
        let intensity = ((t - 0.3) / 0.2) as f32;
        let r = (40.0 + intensity * 20.0) as u8;
        let g = (140.0 + intensity * 60.0) as u8;
        let b = (60.0 + intensity * 20.0) as u8;
        (r, g, b)
    } else if t < 0.7 {
        let intensity = ((t - 0.5) / 0.2) as f32;
        let r = (180.0 + intensity * 60.0) as u8;
        let g = (140.0 - intensity * 40.0) as u8;
        let b = 40.0 as u8;
        (r, g, b)
    } else {
        let intensity = ((t - 0.7) / 0.3) as f32;
        let r = (220.0 + intensity * 35.0).min(255.0) as u8;
        let g = (60.0 + intensity * 100.0).min(255.0) as u8;
        let b = (30.0 + intensity * 80.0).min(255.0) as u8;
        (r, g, b)
    }
}

/// CSV verisinden sentez derinlik yükseklikleri oluştur.
pub fn csv_to_heights(
    signed_field: &[f32],
    grid_w: u32,
    grid_h: u32,
    depth_range_m: f32,
) -> Vec<f32> {
    let n = (grid_w * grid_h) as usize;
    let mut heights = vec![0.0f32; n];

    for i in 0..n {
        let s = signed_field[i].abs();
        heights[i] = -s * depth_range_m * 0.5;
    }

    heights
}

/// CSV verisini doğrudan Surface3D'ye dönüştür.
pub fn csv_to_surface(
    csv: &CsvImportResult,
    file_name: Option<String>,
    view_mode: &str,
    map_size_m: f32,
    depth_range_m: f32,
) -> Result<crate::surface::Surface3D, String> {
    let (signed_field, colors) = csv_to_signed_field(
        &csv.points,
        csv.grid_w,
        csv.grid_h,
        csv.x_min,
        csv.x_max,
        csv.y_min,
        csv.y_max,
        csv.magnetic_min,
        csv.magnetic_max,
    );

    let heights = csv_to_heights(&signed_field, csv.grid_w, csv.grid_h, depth_range_m);

    let z_min = heights.iter().cloned().fold(f32::INFINITY, f32::min);
    let z_max = heights.iter().cloned().fold(f32::NEG_INFINITY, f32::max);

    let map_depth_m = map_size_m * (csv.grid_h as f32 / csv.grid_w.max(1) as f32);

    Ok(crate::surface::Surface3D {
        grid_w: csv.grid_w,
        grid_h: csv.grid_h,
        heights,
        colors,
        z_min,
        z_max,
        source_w: csv.grid_w,
        source_h: csv.grid_h,
        file_name,
        cleaned_preview_base64: None,
        crop: None,
        map_size_m,
        map_width_m: map_size_m,
        map_depth_m,
        depth_range_m,
        view_mode: view_mode.to_string(),
        structures: crate::surface::UndergroundStructures::default(),
        wall_cues: Vec::new(),
        soil_profile: "csv_import".into(),
        soil_depth_scale: 1.0,
        soil_correction_applied: false,
        soil_label: "CSV İçe Aktarma".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_csv_with_header() {
        let csv = "x,y,z,magnetic\n10,20,0.5,123.4\n30,40,0.6,234.5\n";
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.point_count, 2);
        assert_eq!(result.points[0].x, 10.0);
        assert_eq!(result.points[0].y, 20.0);
        assert_eq!(result.points[0].magnetic, 123.4);
    }

    #[test]
    fn parse_csv_without_header() {
        let csv = "10,20,0.5,123.4\n30,40,0.6,234.5\n";
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.point_count, 2);
    }

    #[test]
    fn parse_csv_three_columns() {
        let csv = "10,20,123.4\n30,40,234.5\n";
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.point_count, 2);
        assert_eq!(result.points[0].z, 0.0);
        assert_eq!(result.points[0].magnetic, 123.4);
    }

    #[test]
    fn parse_csv_tab_separated() {
        let csv = "10\t20\t0.5\t123.4\n30\t40\t0.6\t234.5\n";
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.point_count, 2);
    }

    #[test]
    fn parse_csv_empty() {
        let csv = "";
        let result = parse_csv(csv);
        assert!(result.is_err());
    }

    #[test]
    fn parse_csv_thousands_separator() {
        // 3D tarayıcı formatı: tab ile ayrılmış, binlik ayraçlı virgüller
        let csv = "X\tY\tZ\tData\n0\t-300,000,000\t0\t369,887,300\n0\t0\t-300,000,000\t473,015,300\n";
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.point_count, 2);
        assert_eq!(result.points[0].x, 0.0);
        assert_eq!(result.points[0].y, -300000000.0);
        assert_eq!(result.points[0].z, 0.0);
        assert_eq!(result.points[0].magnetic, 369887300.0);
    }

    #[test]
    fn parse_csv_comma_as_thousands() {
        // Virgül binlik ayracı olarak kullanılan format
        let csv = "0 -300,000,000 0 369,887,300\n0 0 -300,000,000 473,015,300\n";
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.point_count, 2);
        assert_eq!(result.points[0].x, 0.0);
        assert_eq!(result.points[0].y, -300000000.0);
        assert_eq!(result.points[0].magnetic, 369887300.0);
    }

    #[test]
    fn parse_csv_uppercase_header() {
        // Büyük harf X/Y/Data başlık
        let csv = "X\tY\tZ\tData\n0\t-300,000,000\t0\t369,887,300\n";
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.point_count, 1);
        assert_eq!(result.points[0].y, -300000000.0);
    }

    #[test]
    fn parse_csv_z_min_max() {
        let csv = "X\tY\tZ\tData\n0\t0\t0\t100\n0\t0\t-300,000,000\t200\n0\t0\t-150,000,000\t150\n";
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.z_min, -300000000.0);
        assert_eq!(result.z_max, 0.0);
    }

    #[test]
    fn magnetic_to_rgb_negative() {
        let (r, _g, b) = magnetic_to_rgb(30.0, 0.0, 200.0);
        assert!(b > r);
    }

    #[test]
    fn magnetic_to_rgb_positive() {
        let (r, _g, b) = magnetic_to_rgb(180.0, 0.0, 200.0);
        assert!(r > b);
    }

    #[test]
    fn csv_to_signed_field_basic() {
        let points = vec![
            CsvDataPoint { x: 0.0, y: 0.0, z: 0.0, magnetic: 100.0 },
            CsvDataPoint { x: 10.0, y: 10.0, z: 0.0, magnetic: 200.0 },
        ];
        let (signed, colors) = csv_to_signed_field(
            &points, 10, 10, 0.0, 10.0, 0.0, 10.0, 100.0, 200.0,
        );
        assert_eq!(signed.len(), 100);
        assert_eq!(colors.len(), 300);
    }

    #[test]
    fn csv_to_heights_produces_negative() {
        let signed = vec![0.0, 0.5, -0.5, 1.0];
        let heights = csv_to_heights(&signed, 2, 2, 15.0);
        assert!(heights[1] < 0.0);
        assert!(heights[2] < 0.0);
    }

    #[test]
    fn parse_sample_magnetic_data() {
        let csv = include_str!("../../examples/sample_magnetic_data.csv");
        let result = parse_csv(csv).unwrap();
        assert!(result.point_count >= 100, "Beklenen en az 100 nokta, bulunan: {}", result.point_count);
        assert!(result.x_min >= 100.0);
        assert!(result.x_max <= 600.0);
        assert!(result.magnetic_min < 0.0);
        assert!(result.magnetic_max > 200.0);
    }

    #[test]
    fn csv_to_surface_full_pipeline() {
        let csv = include_str!("../../examples/sample_magnetic_data.csv");
        let csv_data = parse_csv(csv).unwrap();
        let surface = csv_to_surface(&csv_data, Some("test.csv".into()), "side", 24.0, 15.0).unwrap();
        assert!(surface.grid_w >= 8);
        assert!(surface.grid_h >= 8);
        assert_eq!(surface.heights.len(), (surface.grid_w * surface.grid_h) as usize);
        assert_eq!(surface.colors.len(), (surface.grid_w * surface.grid_h * 3) as usize);
        assert_eq!(surface.view_mode, "side");
    }

    #[test]
    fn parse_3d_scanner_format() {
        // 3D tarayıcı formatı: tab ile ayrılmış, büyük koordinatlar
        let csv = include_str!("../../examples/sample_3d_scanner.csv");
        let result = parse_csv(csv).unwrap();
        assert_eq!(result.point_count, 20);
        // Koordinatlar çok büyük (300M)
        assert!(result.x_min <= -300000000.0);
        assert!(result.x_max >= 300000000.0);
        // Manyetik değerler de büyük
        assert!(result.magnetic_min > 100000000.0);
        assert!(result.magnetic_max > 500000000.0);
        // Z değerleri var
        assert!(result.z_min <= -300000000.0);
    }

    #[test]
    fn csv_to_signed_field_interpolation() {
        let points = vec![
            CsvDataPoint { x: 0.0, y: 0.0, z: 0.0, magnetic: 0.0 },
            CsvDataPoint { x: 10.0, y: 0.0, z: 0.0, magnetic: 100.0 },
            CsvDataPoint { x: 0.0, y: 10.0, z: 0.0, magnetic: 50.0 },
            CsvDataPoint { x: 10.0, y: 10.0, z: 0.0, magnetic: 75.0 },
        ];
        let (signed, colors) = csv_to_signed_field(
            &points, 5, 5, 0.0, 10.0, 0.0, 10.0, 0.0, 100.0,
        );
        assert_eq!(signed.len(), 25);
        assert_eq!(colors.len(), 75);
        assert!(signed[0] <= signed[24]);
    }

    #[test]
    fn magnetic_to_rgb_full_range() {
        let colors: Vec<(u8, u8, u8)> = (0..=10)
            .map(|i| {
                let v = i as f32 * 20.0;
                magnetic_to_rgb(v, 0.0, 200.0)
            })
            .collect();
        assert!(colors[0].2 > colors[0].0);
        assert!(colors[9].0 > colors[9].2);
    }
}

use serde::{Deserialize, Serialize};

use super::types::{LegacyDikMeta, LegacyScanStep};

#[derive(Debug, Deserialize)]
pub(crate) struct OuterDoc {
    #[serde(default)]
    pub(crate) version: Option<String>,
    pub(crate) metadata: OuterMeta,
    pub(crate) scan: serde_json::Value,
    #[serde(default)]
    pub(crate) segment_ranges: Vec<[usize; 2]>,
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct OuterMeta {
    #[serde(default, alias = "version")]
    pub(crate) version: Option<String>,
    #[serde(default)]
    pub(crate) date: Option<String>,
    #[serde(default, alias = "deviceCode", alias = "device")]
    pub(crate) device_code: Option<String>,
    #[serde(default, alias = "xMeters", alias = "width_m", alias = "widthM", alias = "map_width_m")]
    pub(crate) x_meters: Option<f32>,
    #[serde(default, alias = "yMeters", alias = "depth_m", alias = "depthM", alias = "map_depth_m")]
    pub(crate) y_meters: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ScanTable {
    pub(crate) columns: Vec<String>,
    pub(crate) data: Vec<Vec<serde_json::Value>>,
    #[serde(default)]
    pub(crate) index: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub(crate) struct Sample {
    pub(crate) x_m: f32,
    pub(crate) y_m: f32,
    pub(crate) bx: f32,
    pub(crate) by: f32,
    pub(crate) bz: f32,
}

pub(crate) fn cell_f32(v: &serde_json::Value) -> Option<f32> {
    match v {
        serde_json::Value::Number(n) => n.as_f64().map(|x| x as f32),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

pub(crate) fn col_index(columns: &[String], names: &[&str]) -> Option<usize> {
    columns.iter().position(|c| {
        let l = c.to_ascii_lowercase();
        names.iter().any(|n| l == *n)
    })
}


pub fn looks_like_legacy_dik(content: &str, _file_name: Option<&str>) -> bool {
    let trimmed = content.trim_start();
    if !trimmed.starts_with('{') {
        return false;
    }
    parse_outer_and_table(content).is_ok()
}


pub(crate) fn parse_scan_table(value: &serde_json::Value) -> Result<ScanTable, String> {
    let value = match value {
        serde_json::Value::String(raw) => serde_json::from_str::<serde_json::Value>(raw)
            .map_err(|e| format!("scan tablosu okunamadı: {e}"))?,
        other => other.clone(),
    };

    let (columns_value, data_value) = if let Some(object) = value.as_object() {
        (
            object.get("columns").cloned(),
            object
                .get("data")
                .or_else(|| object.get("rows"))
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        )
    } else {
        (None, value.clone())
    };

    let mut columns: Vec<String> = columns_value
        .as_ref()
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let rows = data_value
        .as_array()
        .ok_or_else(|| "scan tablosunda data/rows dizisi yok".to_string())?;
    if rows.is_empty() {
        return Err("scan.data boş".into());
    }

    let data = if rows.iter().all(serde_json::Value::is_object) {
        // Bazı cihaz dışa aktarımları pandas-split yerine records kullanır.
        // İlk görülen anahtar sırası korunur, eksik alanlar null bırakılır.
        if columns.is_empty() {
            let mut seen = std::collections::HashSet::new();
            for row in rows {
                if let Some(object) = row.as_object() {
                    for key in object.keys() {
                        if seen.insert(key.clone()) {
                            columns.push(key.clone());
                        }
                    }
                }
            }
        }
        rows.iter()
            .map(|row| {
                let object = row.as_object().expect("records row object");
                columns
                    .iter()
                    .map(|column| object.get(column).cloned().unwrap_or(serde_json::Value::Null))
                    .collect::<Vec<_>>()
            })
            .collect()
    } else {
        rows.iter()
            .filter_map(|row| row.as_array().cloned())
            .collect::<Vec<_>>()
    };

    if columns.is_empty() {
        return Err("scan.columns yok; records veya pandas-split columns gerekli".into());
    }
    if data.is_empty() {
        return Err("scan.data içinde geçerli satır yok".into());
    }
    Ok(ScanTable { columns, data, index: None })
}

pub(crate) fn first_column(columns: &[String], names: &[&str]) -> Option<usize> {
    names.iter().find_map(|name| col_index(columns, &[*name]))
}

pub(crate) fn parse_outer_and_table(
    content: &str,
) -> Result<(OuterDoc, LegacyDikMeta, ScanTable, usize, usize, usize, usize, usize), String> {
    let root: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Legacy JSON okunamadı: {e}"))?;
    let object = root
        .as_object()
        .ok_or_else(|| "Legacy JSON kök nesne olmalıdır".to_string())?;
    let metadata_value = object
        .get("metadata")
        .or_else(|| object.get("meta"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let metadata: OuterMeta = serde_json::from_value(metadata_value)
        .map_err(|e| format!("metadata okunamadı: {e}"))?;
    let scan_value = if let Some(scan) = object.get("scan").or_else(|| object.get("table")) {
        scan.clone()
    } else if let Some(data) = object.get("data") {
        // Bazı JSON dışa aktarımları scan kabuğunu kaldırıp columns/data'yı köke koyar.
        serde_json::json!({
            "columns": object.get("columns").cloned().unwrap_or(serde_json::Value::Null),
            "data": data.clone(),
        })
    } else {
        return Err("Legacy JSON içinde scan/table/data bulunamadı".into());
    };
    let outer = OuterDoc {
        version: object.get("version").and_then(|v| v.as_str()).map(str::to_string),
        metadata,
        scan: scan_value.clone(),
        segment_ranges: object
            .get("segment_ranges")
            .or_else(|| object.get("segmentRanges"))
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
    };

    let x_meters = outer.metadata.x_meters.unwrap_or(0.0).max(0.1);
    let y_meters = outer.metadata.y_meters.unwrap_or(0.0).max(0.1);
    let meta = LegacyDikMeta {
        device_code: outer
            .metadata
            .device_code
            .clone()
            .unwrap_or_else(|| "Legacy3DMagDevice".into()),
        date: outer.metadata.date.clone(),
        x_meters,
        y_meters,
        version: outer.metadata.version.clone().or(outer.version.clone()),
    };

    let table = parse_scan_table(&outer.scan)?;

    // Legacy3DMag cihazı x/y/z manyetik bileşenlerini kullanır. Yeni dışa
    // aktarımlarda bunlar Bx/By/Bz veya magnetic_x/... olarak adlandırılabilir.
    // Konum sütunları varsa, manyetik sütunlarla karıştırma.
    let cols_hint = table.columns.join(", ");
    let has_b_components = first_column(&table.columns, &["bx", "mag_x", "magnetic_x", "field_x"]).is_some();
    let ix = if has_b_components {
        first_column(&table.columns, &["bx", "mag_x", "magnetic_x", "field_x"]).unwrap()
    } else {
        first_column(&table.columns, &["x"]).ok_or_else(|| {
            format!("scan: manyetik X/Bx kolonu yok (kolonlar: {cols_hint})")
        })?
    };
    let iy = if has_b_components {
        first_column(&table.columns, &["by", "mag_y", "magnetic_y", "field_y"]).ok_or_else(|| {
            format!("scan: manyetik Y/By kolonu yok (kolonlar: {cols_hint})")
        })?
    } else {
        first_column(&table.columns, &["y"]).ok_or_else(|| {
            format!("scan: manyetik Y/By kolonu yok (kolonlar: {cols_hint})")
        })?
    };
    let iz = if has_b_components {
        first_column(&table.columns, &["bz", "mag_z", "magnetic_z", "field_z"])
            .ok_or_else(|| format!("scan: manyetik Z/Bz kolonu yok (kolonlar: {cols_hint})"))?
    } else {
        first_column(&table.columns, &["z"])
            .ok_or_else(|| format!("scan: manyetik Z/Bz kolonu yok (kolonlar: {cols_hint})"))?
    };
    let ixm = first_column(&table.columns, &["x_coords", "x_coord", "pos_x", "position_x", "east", "easting"])
        .or_else(|| if has_b_components { first_column(&table.columns, &["x"]) } else { None })
        .ok_or_else(|| format!("scan: konum X/x_coords kolonu yok (kolonlar: {cols_hint})"))?;
    let iym = first_column(&table.columns, &["y_coords", "y_coord", "pos_y", "position_y", "north", "northing"])
        .or_else(|| if has_b_components { first_column(&table.columns, &["y"]) } else { None })
        .ok_or_else(|| format!("scan: konum Y/y_coords kolonu yok (kolonlar: {cols_hint})"))?;

    // Aynı kolon hem manyetik hem konum olamaz — sessiz tahmin yok.
    if ix == ixm || iy == iym || iz == ixm || iz == iym {
        return Err(format!(
            "scan: manyetik ve konum kolonları çakışıyor (Bx@{ix}, By@{iy}, Bz@{iz}, X@{ixm}, Y@{iym}; kolonlar: {cols_hint})"
        ));
    }

    Ok((outer, meta, table, ix, iy, iz, ixm, iym))
}

pub(crate) fn scan_step_metrics(
    table: &ScanTable,
    segments: &[[usize; 2]],
    ixm: usize,
    iym: usize,
) -> Vec<LegacyScanStep> {
    let mut steps = Vec::with_capacity(segments.len());
    let mut previous_center: Option<(f32, f32)> = None;
    for (step_idx, &[start, end]) in segments.iter().enumerate() {
        let s = start.min(table.data.len());
        let e = end.min(table.data.len());
        let mut xs = Vec::new();
        let mut ys = Vec::new();
        for row in table.data.get(s..e).unwrap_or(&[]) {
            if let (Some(x), Some(y)) = (row.get(ixm).and_then(cell_f32), row.get(iym).and_then(cell_f32)) {
                if x.is_finite() && y.is_finite() {
                    xs.push(x);
                    ys.push(y);
                }
            }
        }
        if xs.is_empty() {
            continue;
        }
        let x_start_m = xs.iter().copied().fold(f32::INFINITY, f32::min);
        let x_end_m = xs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let y_start_m = ys.iter().copied().fold(f32::INFINITY, f32::min);
        let y_end_m = ys.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let x_center_m = xs.iter().sum::<f32>() / xs.len() as f32;
        let y_center_m = ys.iter().sum::<f32>() / ys.len() as f32;
        let spacing_from_previous_m = previous_center
            .map(|(px, py)| (x_center_m - px).hypot(y_center_m - py))
            .unwrap_or(0.0);
        previous_center = Some((x_center_m, y_center_m));
        steps.push(LegacyScanStep {
            index: (step_idx + 1) as u32,
            start: s,
            end: e,
            x_start_m,
            x_end_m,
            x_center_m,
            y_start_m,
            y_end_m,
            y_center_m,
            width_m: (x_end_m - x_start_m).abs(),
            length_m: (y_end_m - y_start_m).abs(),
            point_count: xs.len(),
            spacing_from_previous_m,
        });
    }
    order_scan_steps_left_first(steps)
}

/// Tarama matrisi sırası: örn. 6×3 = 18 adım.
/// Soldan sağa sütun; serpantin — çift sütun Y↑, tek sütun Y↓.
/// Net ızgara yoksa X/Y açıklığına göre yedek sıra (idempotent).
pub(crate) fn order_scan_steps_left_first(mut steps: Vec<LegacyScanStep>) -> Vec<LegacyScanStep> {
    if steps.len() < 2 {
        for (i, step) in steps.iter_mut().enumerate() {
            step.index = (i + 1) as u32;
            step.spacing_from_previous_m = 0.0;
        }
        return steps;
    }

    // `scan_steps` giriş dizisi sensörün gerçek fiziksel gidiş-dönüş sırasıdır.
    // Soldan tutuş, hat dönüşü ve sonraki hatta bir adım kayma bu sırada
    // zaten kayıtlıdır. Koordinata göre sıralamak gerçek tarama sırasını bozar.

    let mut previous: Option<(f32, f32)> = None;
    for (i, step) in steps.iter_mut().enumerate() {
        step.index = (i + 1) as u32;
        step.spacing_from_previous_m = previous
            .map(|(px, py)| (step.x_center_m - px).hypot(step.y_center_m - py))
            .unwrap_or(0.0);
        previous = Some((step.x_center_m, step.y_center_m));
    }
    steps
}

fn cluster_tolerance(values: &[f32]) -> f32 {
    let mut sorted: Vec<f32> = values.iter().copied().filter(|v| v.is_finite()).collect();
    if sorted.len() < 2 {
        return 0.15;
    }
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut gaps = Vec::new();
    for window in sorted.windows(2) {
        let gap = window[1] - window[0];
        if gap > 1e-6 {
            gaps.push(gap);
        }
    }
    if gaps.is_empty() {
        return 0.15;
    }
    gaps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = gaps[gaps.len() / 2];
    (median * 0.45).max(0.05)
}

fn cluster_axis_values(values: &[f32], tol: f32) -> Vec<f32> {
    let mut sorted: Vec<f32> = values.iter().copied().filter(|v| v.is_finite()).collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if sorted.is_empty() {
        return Vec::new();
    }
    let mut means = Vec::new();
    let mut sum = sorted[0];
    let mut n = 1usize;
    let mut mean = sorted[0];
    for &value in sorted.iter().skip(1) {
        if (value - mean).abs() > tol {
            means.push(mean);
            sum = value;
            n = 1;
            mean = value;
        } else {
            sum += value;
            n += 1;
            mean = sum / n as f32;
        }
    }
    means.push(mean);
    means
}

fn nearest_cluster_index(value: f32, centers: &[f32]) -> usize {
    let mut best = 0usize;
    let mut best_dist = f32::INFINITY;
    for (index, &center) in centers.iter().enumerate() {
        let dist = (value - center).abs();
        if dist < best_dist {
            best_dist = dist;
            best = index;
        }
    }
    best
}

pub(crate) fn average_step_spacing(steps: &[LegacyScanStep]) -> f32 {
    let values: Vec<f32> = steps
        .iter()
        .skip(1)
        .map(|step| step.spacing_from_previous_m)
        .filter(|value| value.is_finite() && *value > 0.0)
        .collect();
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f32>() / values.len() as f32
    }
}

pub(crate) fn samples_from_table(
    table: &ScanTable,
    ix: usize,
    iy: usize,
    iz: usize,
    ixm: usize,
    iym: usize,
) -> Result<Vec<Sample>, String> {
    let mut samples = Vec::with_capacity(table.data.len());
    let need = ix.max(iy).max(iz).max(ixm).max(iym);
    for row in &table.data {
        if row.len() <= need {
            continue;
        }
        let (Some(bx), Some(by), Some(bz), Some(xm), Some(ym)) = (
            cell_f32(&row[ix]),
            cell_f32(&row[iy]),
            cell_f32(&row[iz]),
            cell_f32(&row[ixm]),
            cell_f32(&row[iym]),
        ) else {
            continue;
        };
        if !bx.is_finite() || !by.is_finite() || !bz.is_finite() || !xm.is_finite() || !ym.is_finite() {
            continue;
        }
        samples.push(Sample {
            x_m: xm,
            y_m: ym,
            bx,
            by,
            bz,
        });
    }
    if samples.len() < 4 {
        return Err(format!(
            "Yetersiz örnek ({}) — en az 4 nokta gerekli",
            samples.len()
        ));
    }
    Ok(samples)
}

pub(crate) fn estimate_step_count_from_spacing(
    table: &ScanTable,
    ixm: usize,
    iym: usize,
    spacing_m: f32,
) -> u32 {
    if !spacing_m.is_finite() || spacing_m <= 0.0 {
        return 0;
    }
    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for row in &table.data {
        if let (Some(x), Some(y)) = (
            row.get(ixm).and_then(cell_f32),
            row.get(iym).and_then(cell_f32),
        ) {
            if x.is_finite() && y.is_finite() {
                xs.push(x);
                ys.push(y);
            }
        }
    }
    if xs.is_empty() || ys.is_empty() {
        return 1;
    }
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    ys.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    xs.dedup_by(|a, b| (*a - *b).abs() < 1e-3);
    ys.dedup_by(|a, b| (*a - *b).abs() < 1e-3);

    // Dik taramada bir eksen boyunca yürünür, diğer eksen adımlar arasında
    // değişir. Daha az benzersiz koordinata sahip ekseni adım ekseni kabul et.
    let positions = if xs.len() <= ys.len() { xs } else { ys };
    let span = positions.last().copied().unwrap_or(0.0) - positions.first().copied().unwrap_or(0.0);
    if span <= spacing_m * 0.5 {
        1
    } else {
        ((span / spacing_m).round() as u32 + 1).clamp(1, table.data.len().max(1) as u32)
    }
}

pub(crate) fn resolve_scan_segments(
    row_count: usize,
    requested_steps: Option<u32>,
    json_segments: &[[usize; 2]],
) -> Result<Vec<[usize; 2]>, String> {
    if row_count == 0 {
        return Err("scan.data boş".into());
    }

    let requested = requested_steps.unwrap_or(0);
    if requested > 0 {
        let steps = requested as usize;
        if steps > row_count {
            return Err(format!(
                "Adım sayısı ({requested}) ölçüm satırından ({row_count}) fazla olamaz"
            ));
        }
        // Manuel ızgara, ham kayıtları global olarak bölmemeli: JSON'daki her
        // fiziksel geçiş kendi içinde hücrelere ayrılır. Örn. 3 geçiş + 18
        // hücre => her geçiş 6 hücre; aksi halde bir hattın sonu sonraki
        // hattın başıyla birleşir ve adım merkezi yanlış yere taşınır.
        if !json_segments.is_empty() && steps >= json_segments.len() && steps % json_segments.len() == 0 {
            let cells_per_segment = steps / json_segments.len();
            return Ok(json_segments
                .iter()
                .flat_map(|[seg_start, seg_end]| {
                    (0..cells_per_segment).map(move |i| {
                        let start = seg_start + i * (seg_end - seg_start) / cells_per_segment;
                        let end = seg_start + (i + 1) * (seg_end - seg_start) / cells_per_segment;
                        [start, end]
                    })
                })
                .collect());
        }
        // JSON'da fiziksel geçiş yoksa ardışık kayıtları dengeli böl.
        return Ok((0..steps)
            .map(|i| {
                let start = i * row_count / steps;
                let end = (i + 1) * row_count / steps;
                [start, end]
            })
            .collect());
    }

    if json_segments.is_empty() {
        Ok(vec![[0, row_count]])
    } else {
        Ok(json_segments.to_vec())
    }
}

pub(crate) fn parse_samples_with_steps(
    content: &str,
    requested_steps: Option<u32>,
) -> Result<(LegacyDikMeta, Vec<Sample>, Vec<[usize; 2]>), String> {
    let (outer, meta, table, ix, iy, iz, ixm, iym) = parse_outer_and_table(content)?;
    let segments = resolve_scan_segments(table.data.len(), requested_steps, &outer.segment_ranges)?;
    let samples = samples_from_table(&table, ix, iy, iz, ixm, iym)?;
    Ok((meta, samples, segments))
}

pub(crate) fn parse_samples(content: &str) -> Result<(LegacyDikMeta, Vec<Sample>, Vec<[usize; 2]>), String> {
    parse_samples_with_steps(content, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legacy_mag_json::types::LegacyScanStep;

    fn step(x: f32, y: f32) -> LegacyScanStep {
        LegacyScanStep {
            index: 0,
            start: 0,
            end: 0,
            x_start_m: x,
            x_end_m: x,
            x_center_m: x,
            y_start_m: y,
            y_end_m: y,
            y_center_m: y,
            width_m: 0.0,
            length_m: 0.0,
            point_count: 1,
            spacing_from_previous_m: 0.0,
        }
    }

    #[test]
    fn matrix_6x3_keeps_physical_goto_return_order() {
        let mut steps = Vec::new();
        // Üç hat: 6 adım gidiş, 6 adım dönüş ve sonraki hatta bir adım kayma.
        for x in 0..6 {
            steps.push(step(x as f32, 0.0));
        }
        for x in (0..6).rev() {
            steps.push(step(x as f32, 1.0));
        }
        for x in 0..6 {
            steps.push(step(x as f32 + 0.5, 2.0));
        }
        let ordered = order_scan_steps_left_first(steps);
        assert_eq!(ordered.len(), 18);
        assert_eq!((ordered[0].x_center_m, ordered[0].y_center_m), (0.0, 0.0));
        assert_eq!((ordered[5].x_center_m, ordered[5].y_center_m), (5.0, 0.0));
        assert_eq!((ordered[6].x_center_m, ordered[6].y_center_m), (5.0, 1.0));
        assert_eq!((ordered[11].x_center_m, ordered[11].y_center_m), (0.0, 1.0));
        assert_eq!((ordered[12].x_center_m, ordered[12].y_center_m), (0.5, 2.0));
        assert_eq!(ordered[17].index, 18);
    }
}


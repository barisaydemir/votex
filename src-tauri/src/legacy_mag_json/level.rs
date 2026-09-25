use super::parse::parse_outer_and_table;
use super::types::{LegacyLevelResult, LevelStats, SegmentMedian};

pub fn median_f64(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len();
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        0.5 * (sorted[n / 2 - 1] + sorted[n / 2])
    }
}

pub(crate) fn cell_f64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

pub(crate) fn set_cell_f64(row: &mut [serde_json::Value], idx: usize, v: f64) {
    if idx < row.len() {
        row[idx] = serde_json::json!(v);
    }
}

/// Clamp half-open `[start, end)` segment into `0..n`.
pub(crate) fn clamp_segment(start: usize, end: usize, n: usize) -> Option<(usize, usize)> {
    if n == 0 {
        return None;
    }
    let s = start.min(n);
    let e = end.min(n);
    if e <= s {
        None
    } else {
        Some((s, e))
    }
}


pub fn zero_order_median_level_xy(
    data: &mut [Vec<serde_json::Value>],
    ix: usize,
    iy: usize,
    segment_ranges: &[[usize; 2]],
) -> Result<LevelStats, String> {
    let n = data.len();
    if n == 0 {
        return Err("scan.data boş".into());
    }

    let ranges: Vec<(usize, usize)> = if segment_ranges.is_empty() {
        vec![(0, n)]
    } else {
        segment_ranges
            .iter()
            .filter_map(|r| clamp_segment(r[0], r[1], n))
            .collect()
    };
    if ranges.is_empty() {
        return Err("segment_ranges geçerli satır aralığı üretmedi".into());
    }

    let mut segment_medians = Vec::with_capacity(ranges.len());
    let mut ref_mx = 0.0f64;
    let mut ref_my = 0.0f64;
    let mut have_ref = false;

    // Pass 1: segment medians + reference from first non-empty segment
    for &(s, e) in &ranges {
        let mut xs = Vec::with_capacity(e - s);
        let mut ys = Vec::with_capacity(e - s);
        for row in &data[s..e] {
            if row.len() > ix {
                if let Some(v) = cell_f64(&row[ix]) {
                    xs.push(v);
                }
            }
            if row.len() > iy {
                if let Some(v) = cell_f64(&row[iy]) {
                    ys.push(v);
                }
            }
        }
        if xs.is_empty() || ys.is_empty() {
            segment_medians.push(SegmentMedian {
                start: s,
                end: e,
                median_x: 0.0,
                median_y: 0.0,
                point_count: 0,
            });
            continue;
        }
        let mx = median_f64(&xs);
        let my = median_f64(&ys);
        if !have_ref {
            ref_mx = mx;
            ref_my = my;
            have_ref = true;
        }
        segment_medians.push(SegmentMedian {
            start: s,
            end: e,
            median_x: mx,
            median_y: my,
            point_count: xs.len().min(ys.len()),
        });
    }
    if !have_ref {
        return Err("Hiçbir segmentte manyetik x/y okunamadı".into());
    }

    // Pass 2: new = old - segment_median + reference_median
    for seg in &segment_medians {
        if seg.point_count == 0 {
            continue;
        }
        let dx = -seg.median_x + ref_mx;
        let dy = -seg.median_y + ref_my;
        if dx.abs() < f64::EPSILON && dy.abs() < f64::EPSILON {
            continue;
        }
        for row in &mut data[seg.start..seg.end] {
            if row.len() > ix {
                if let Some(old) = cell_f64(&row[ix]) {
                    set_cell_f64(row, ix, old + dx);
                }
            }
            if row.len() > iy {
                if let Some(old) = cell_f64(&row[iy]) {
                    set_cell_f64(row, iy, old + dy);
                }
            }
        }
    }

    Ok(LevelStats {
        reference_median_x: ref_mx,
        reference_median_y: ref_my,
        segment_count: segment_medians.len(),
        segment_medians,
    })
}

pub fn level_legacy_mag_json(content: &str) -> Result<LegacyLevelResult, String> {
    let (outer, _meta, mut table, ix, iy, iz, ixm, iym) = parse_outer_and_table(content)?;
    let segments = outer.segment_ranges.clone();
    let stats = zero_order_median_level_xy(&mut table.data, ix, iy, &segments)?;

    let need = ix.max(iy).max(iz).max(ixm).max(iym);
    let mut data = Vec::with_capacity(table.data.len());
    for row in &table.data {
        if row.len() <= need {
            continue;
        }
        let mut out = Vec::with_capacity(6);
        for i in 0..=need {
            out.push(cell_f64(&row[i]).unwrap_or(0.0));
        }
        data.push(out);
    }

    let scan_payload = serde_json::to_string(&table)
        .map_err(|e| format!("leveled scan serialize: {e}"))?;

    let mut root: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("root JSON: {e}"))?;
    if let Some(obj) = root.as_object_mut() {
        obj.insert("scan".into(), serde_json::Value::String(scan_payload));
    }
    let leveled_json =
        serde_json::to_string(&root).map_err(|e| format!("leveled JSON: {e}"))?;

    Ok(LegacyLevelResult {
        ok: true,
        message: format!(
            "Zero-order median leveling · {} satır · {} segment · ref Bx={:.1} By={:.1}",
            data.len(),
            stats.segment_count,
            stats.reference_median_x,
            stats.reference_median_y
        ),
        columns: table.columns,
        data,
        stats,
        leveled_json,
    })
}

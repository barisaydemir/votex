mod parser;

use parser::{parse_xyz_content, ParsedDataset};
use std::fs;

#[tauri::command]
fn parse_xyz_file(file_path: String) -> Result<ParsedDataset, String> {
    let path = std::path::Path::new(&file_path);
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "dataset.csv".to_string());

    let content = fs::read_to_string(path).map_err(|e| format!("Dosya okunamadı: {e}"))?;
    parse_xyz_content(&content, &file_name)
}

#[tauri::command]
fn pick_and_parse_xyz() -> Result<Option<ParsedDataset>, String> {
    // Başlangıç klasörünü belirle — B: drive hatasını önlemek için
    let start_dir = dirs::home_dir()
        .or_else(|| dirs::desktop_dir())
        .or_else(|| dirs::document_dir())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let picked = rfd::FileDialog::new()
        .set_title("3D XYZ + Anomali Dosyası Seç")
        .set_directory(&start_dir)
        .add_filter("XYZ & Anomaly Files", &["csv", "txt", "dat", "tsv", "asc"])
        .add_filter("Tüm Dosyalar", &["*"])
        .pick_file();

    match picked {
        Some(path) => {
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "dataset.csv".to_string());

            let content = fs::read_to_string(&path).map_err(|e| format!("Dosya okunamadı: {e}"))?;
            let dataset = parse_xyz_content(&content, &file_name)?;
            Ok(Some(dataset))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn get_sample_xyz_dataset() -> Result<ParsedDataset, String> {
    // Generates a synthetic magnetic anomaly 3D terrain grid for immediate testing
    let mut csv_data = String::from("X,Y,Z,Anomaly\n");
    let rows = 40;
    let cols = 40;

    for r in 0..rows {
        for c in 0..cols {
            let x = c as f64 * 1.5;
            let y = r as f64 * 1.5;
            // 3D terrain height profile (Z)
            let z = (x * 0.15).sin() * 2.0 + (y * 0.12).cos() * 1.5 - 3.0;

            // Anomaly signal (simulated dipole anomaly at center: X=30, Y=30)
            let dist_sq = (x - 30.0).powi(2) + (y - 30.0).powi(2);
            let anomaly = 150.0 * (-dist_sq / 80.0).exp() - 60.0 * (-(x - 35.0).powi(2) / 40.0 - (y - 25.0).powi(2) / 40.0).exp() + 10.0;

            csv_data.push_str(&format!("{:.2},{:.2},{:.2},{:.2}\n", x, y, z, anomaly));
        }
    }

    parse_xyz_content(&csv_data, "Örnek_Manyetik_Anomali_XYZ.csv")
}

#[tauri::command]
fn parse_xyz_text(content: String, file_name: String) -> Result<ParsedDataset, String> {
    parse_xyz_content(&content, &file_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            parse_xyz_file,
            pick_and_parse_xyz,
            parse_xyz_text,
            get_sample_xyz_dataset,
        ])
        .run(tauri::generate_context!())
        .expect("Votex 3D Visualizer başlatılamadı");
}

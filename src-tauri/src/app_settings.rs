//! Kalıcı VOTEX ayarları (%APPDATA%\Votex\settings.json).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

/// Test izolasyonu: smoke testleri gerçek disk ayarına (kullanıcının
/// settings.json'undaki probFallback) bağımlı kalmamalı. Test build'de
/// `load_settings` bu statik override'ı uygular (0 = diskten, 1 = zorla true,
/// -1 = zorla false). Üretim build'inde bu değer hiç okunmaz.
#[cfg(test)]
use std::sync::atomic::AtomicI8;
#[cfg(test)]
static TEST_PROB_FALLBACK_OVERRIDE: AtomicI8 = AtomicI8::new(0);

/// Testler için `prob_fallback`'ı diske dokunmadan zorla (None = diskten oku).
#[cfg(test)]
pub fn set_test_prob_fallback(v: Option<bool>) {
    TEST_PROB_FALLBACK_OVERRIDE.store(
        match v {
            Some(true) => 1,
            Some(false) => -1,
            None => 0,
        },
        Ordering::SeqCst,
    );
}

pub const DEFAULT_DTA_LAUNCH: &str = r"C:\surface-z\Surface-z\launcher.py";
/// Kurulum sonrası varsayılan (saha)
pub const INSTALLED_DTA_LAUNCH: &str =
    r"%LOCALAPPDATA%\Programs\DerinTaramaAsistan\launcher.py";
/// VOTEX'in başlattığı DTA konsol başlığı (kapanışta bulunur)
pub const OWNED_DTA_CONSOLE_TITLE: &str = "VOTEX-DTA";

/// Bu VOTEX oturumunun başlattığı cmd.exe PID (0 = yok)
static OWNED_DTA_PID: AtomicU32 = AtomicU32::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// DTA başlatıcı (launcher.py / klasör / .bat / .exe)
    #[serde(default = "default_dta_launch")]
    pub dta_launch_path: String,
    /// VOTEX açılınca DTA'yı otomatik başlat
    #[serde(default = "default_true")]
    pub auto_launch_dta: bool,
    /// VotexProb.exe yolu
    #[serde(default)]
    pub prob_engine_path: String,
    /// VOTEX açılınca VPE otomatik başlat
    #[serde(default = "default_true")]
    pub auto_launch_prob: bool,
    /// standard | corridor
    #[serde(default = "default_prob_profile")]
    pub prob_profile: String,
    /// VPE yok/hata → legacy skor (Faz A–C zorunlu true)
    #[serde(default = "default_true")]
    pub prob_fallback: bool,
    /// Güncelleme paketi klasörü (manifest.json içeren)
    #[serde(default)]
    pub update_package_path: String,
    /// Toprak derinlik düzeltmesi açık mı (kapalı = legacy)
    #[serde(default = "default_true")]
    pub soil_correction_enabled: bool,
    /// Son seçilen toprak profili
    #[serde(default = "default_soil_profile")]
    pub soil_profile: String,
    /// Kırmızı anomali yapı çizimini engellemesin (kapalı = legacy path/reject)
    #[serde(default = "default_true")]
    pub structures_through_red: bool,
    /// 3D ipucu topları (DTA/CSV yapı işaretleri) görünür mü
    #[serde(default = "default_true")]
    pub hints_3d_visible: bool,

    // ── CSV filtre tercihleri ──
    /// Havuz boyutu (metre)
    #[serde(default = "default_csv_pool_size")]
    pub csv_pool_size: u32,
    /// Manyetik sigma (1..4)
    #[serde(default = "default_csv_sigma")]
    pub csv_sigma: f64,
    /// Sığdırma yüzdesi (50..100)
    #[serde(default = "default_csv_fit")]
    pub csv_fit: u32,
    /// Otomatik kutu
    #[serde(default)]
    pub csv_auto_box: bool,
    /// Nokta boyutu
    #[serde(default = "default_csv_point_size")]
    pub csv_point_size: f64,
    /// Dilim sayısı
    #[serde(default = "default_csv_slice_count")]
    pub csv_slice_count: u32,
    /// Yapı tespit eşiği
    #[serde(default = "default_csv_threshold")]
    pub csv_threshold: f64,
    /// Minimum anomali şiddeti
    #[serde(default = "default_csv_min_strength")]
    pub csv_min_strength: f64,
    /// Grid çözünürlüğü
    #[serde(default = "default_csv_grid_res")]
    pub csv_grid_res: u32,
    /// Yeraltı filtresi
    #[serde(default = "default_true")]
    pub csv_underground_only: bool,
}

fn default_soil_profile() -> String {
    "loam".into()
}

fn default_prob_profile() -> String {
    "standard".into()
}

fn default_csv_pool_size() -> u32 {
    30
}
fn default_csv_sigma() -> f64 {
    2.0
}
fn default_csv_fit() -> u32 {
    85
}
fn default_csv_point_size() -> f64 {
    0.2
}
fn default_csv_slice_count() -> u32 {
    8
}
fn default_csv_threshold() -> f64 {
    0.9
}
fn default_csv_min_strength() -> f64 {
    0.45
}
fn default_csv_grid_res() -> u32 {
    32
}

fn default_dta_launch() -> String {
    resolve_default_dta_launch()
}

/// Saha: kurulu DTA; yoksa geliştirme yolu (surface-z).
fn resolve_default_dta_launch() -> String {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    if let Some(base) = local {
        let installed = base
            .join("Programs")
            .join("DerinTaramaAsistan")
            .join("launcher.py");
        if installed.is_file() {
            return installed.to_string_lossy().into_owned();
        }
        let baslat = base
            .join("Programs")
            .join("DerinTaramaAsistan")
            .join("baslat.vbs");
        if baslat.is_file() {
            return baslat.to_string_lossy().into_owned();
        }
    }
    let expanded = PathBuf::from(
        INSTALLED_DTA_LAUNCH.replace(
            "%LOCALAPPDATA%",
            &std::env::var("LOCALAPPDATA").unwrap_or_default(),
        ),
    );
    if expanded.is_file() {
        return expanded.to_string_lossy().into_owned();
    }
    DEFAULT_DTA_LAUNCH.into()
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            dta_launch_path: default_dta_launch(),
            auto_launch_dta: true,
            prob_engine_path: String::new(),
            auto_launch_prob: true,
            prob_profile: default_prob_profile(),
            prob_fallback: true,
            update_package_path: String::new(),
            soil_correction_enabled: true,
            soil_profile: default_soil_profile(),
            structures_through_red: true,
            hints_3d_visible: true,
            csv_pool_size: default_csv_pool_size(),
            csv_sigma: default_csv_sigma(),
            csv_fit: default_csv_fit(),
            csv_auto_box: false,
            csv_point_size: default_csv_point_size(),
            csv_slice_count: default_csv_slice_count(),
            csv_threshold: default_csv_threshold(),
            csv_min_strength: default_csv_min_strength(),
            csv_grid_res: default_csv_grid_res(),
            csv_underground_only: true,
        }
    }
}

fn settings_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .ok_or_else(|| "APPDATA bulunamadı".to_string())?;
    Ok(base.join("Votex").join("settings.json"))
}

pub fn load_settings() -> AppSettings {
    let Ok(path) = settings_path() else {
        return AppSettings::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return AppSettings::default();
    };
    let mut s: AppSettings = serde_json::from_str(&raw).unwrap_or_default();
    // Test izolasyonu: smoke testleri gerçek kullanıcı ayarına bağımlı kalmamalı.
    // Motor çevrimdışıyken legacy fallback'in açık kalması için zorla true.
    #[cfg(test)]
    match TEST_PROB_FALLBACK_OVERRIDE.load(Ordering::SeqCst) {
        1 => s.prob_fallback = true,
        -1 => s.prob_fallback = false,
        _ => {}
    }
    // Eski sabit surface-z yolu veya baslat.bat → kurulu launcher tercih
    let launch = PathBuf::from(s.dta_launch_path.trim());
    let broken = !launch.exists()
        || s.dta_launch_path.contains(r"C:\surface-z")
        || s.dta_launch_path.to_ascii_lowercase().ends_with("baslat.bat");
    if broken {
        let preferred = resolve_default_dta_launch();
        if PathBuf::from(&preferred).is_file() {
            s.dta_launch_path = preferred;
            let _ = save_settings(&s);
        }
    } else {
        let preferred = prefer_launcher_path(&launch);
        if preferred != launch && preferred.is_file() {
            s.dta_launch_path = preferred.to_string_lossy().into_owned();
            let _ = save_settings(&s);
        }
    }
    s
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Ayar klasörü: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| format!("Ayar yazılamadı: {e}"))
}

fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

/// Ayar yolunu normalize et: klasör / eski bat → mümkünse `launcher.py`.
pub fn resolve_launch_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("DTA başlat yolu boş".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!(
            "Dosya yok: {trimmed}\nBeklenen örnek: {DEFAULT_DTA_LAUNCH}"
        ));
    }
    let path = strip_verbatim(path.canonicalize().unwrap_or(path));
    Ok(prefer_launcher_path(&path))
}

/// bat/cmd/vbs veya DTA klasörü verildiyse kardeş `launcher.py` tercih edilir.
fn prefer_launcher_path(path: &Path) -> PathBuf {
    if path.is_dir() {
        let launcher = path.join("launcher.py");
        if launcher.is_file() {
            return launcher;
        }
        let bat = path.join("baslat.bat");
        if bat.is_file() {
            return bat;
        }
        return path.to_path_buf();
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        name.as_str(),
        "baslat.bat" | "baslat.cmd" | "baslat.vbs" | "main.py"
    ) {
        if let Some(dir) = path.parent() {
            let launcher = dir.join("launcher.py");
            if launcher.is_file() {
                return launcher;
            }
        }
    }
    path.to_path_buf()
}

fn dta_dir_from_launch(path: &Path) -> PathBuf {
    if path.is_dir() {
        return path.to_path_buf();
    }
    path.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Host pythonw / pyw (venv yokken launcher.py için).
fn find_host_pythonw() -> Option<(String, Vec<String>)> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let probes: &[(&str, &[&str])] = &[
            ("pyw", &["-3.12"]),
            ("pyw", &[]),
            ("pythonw", &[]),
        ];
        for (exe, pre) in probes {
            let mut args: Vec<String> = pre.iter().map(|s| (*s).to_string()).collect();
            args.push("-c".into());
            args.push("import sys; print(1)".into());
            let mut c = Command::new(exe);
            c.args(&args);
            if let Ok(o) = c.creation_flags(CREATE_NO_WINDOW).output() {
                if o.status.success() {
                    return Some((
                        (*exe).to_string(),
                        pre.iter().map(|s| (*s).to_string()).collect(),
                    ));
                }
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Kopyalanmış venv başka PC yoluna (örn. cpbar) bağlıysa kullanma.
fn venv_python_usable(venv_pyw: &Path) -> bool {
    if !venv_pyw.is_file() {
        return false;
    }
    let cfg = venv_pyw
        .parent()
        .and_then(|s| s.parent())
        .map(|v| v.join("pyvenv.cfg"));
    let Some(cfg) = cfg else {
        return true;
    };
    if !cfg.is_file() {
        return true;
    }
    let Ok(text) = fs::read_to_string(&cfg) else {
        return true;
    };
    for line in text.lines() {
        let line = line.trim();
        if let Some(home) = line.strip_prefix("home = ").or_else(|| line.strip_prefix("home=")) {
            let home = home.trim();
            if !home.is_empty() && !Path::new(home).is_dir() {
                return false;
            }
        }
        if let Some(exe) = line
            .strip_prefix("executable = ")
            .or_else(|| line.strip_prefix("executable="))
        {
            let exe = exe.trim();
            if !exe.is_empty() && !Path::new(exe).is_file() {
                return false;
            }
        }
    }
    true
}

/// DTA / Derin Tarama Asistan penceresi açık mı? (çift örnek önleme)
pub fn dta_appears_running() -> bool {
    let Ok(windows) = xcap::Window::all() else {
        return false;
    };
    for w in windows {
        let title = w.title().to_ascii_lowercase();
        if title.is_empty() {
            continue;
        }
        // Tercihen asistan adı; kısa "dta" yalnız başına çok yanlış pozitif verir
        if title.contains("derin tarama")
            || title.contains("derin_tarama")
            || (title.contains("asistan") && title.contains("dta"))
        {
            return true;
        }
    }
    false
}

/// Ayar + çift örnek kontrolü ile DTA başlat (manuel veya auto).
pub fn try_launch_dta(force: bool) -> Result<AutoLaunchOutcome, String> {
    let s = load_settings();
    if !force && !s.auto_launch_dta {
        return Ok(AutoLaunchOutcome {
            ok: true,
            skipped: true,
            reason: "disabled".into(),
            message: "Otomatik DTA kapalı (ayar)".into(),
        });
    }
    if dta_appears_running() {
        return Ok(AutoLaunchOutcome {
            ok: true,
            skipped: true,
            reason: "already_running".into(),
            message: "DTA zaten açık".into(),
        });
    }
    let path = resolve_launch_path(&s.dta_launch_path)?;
    let pid = launch_path(&path)?;
    Ok(AutoLaunchOutcome {
        ok: true,
        skipped: false,
        reason: "launched".into(),
        message: format!("DTA başlatıldı: {} (pid {pid})", path.display()),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLaunchOutcome {
    pub ok: bool,
    pub skipped: bool,
    pub reason: String,
    pub message: String,
}

/// Windows: launcher.py (Tk splash) öncelikli; CMD görünmez; PID kaydet.
/// Erken çöküşte hata konsolu açılır.
pub fn launch_path(path: &Path) -> Result<u32, String> {
    let path = prefer_launcher_path(&strip_verbatim(
        path.canonicalize()
            .unwrap_or_else(|_| path.to_path_buf()),
    ));
    let dir = dta_dir_from_launch(&path);

    if path.is_dir() {
        return Err(format!(
            "DTA klasöründe launcher.py yok: {}",
            path.display()
        ));
    }
    if !path.is_file() {
        return Err(format!("Dosya değil: {}", path.display()));
    }

    #[cfg(windows)]
    {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        use std::process::Stdio;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let log_path = dta_launch_log_path();
        if let Some(parent) = log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(
            &log_path,
            format!(
                "VOTEX DTA launch {}\r\npath={}\r\n",
                chrono_stamp(),
                path.display()
            ),
        );

        let log_out = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("DTA log açılamadı: {e}"))?;
        let log_err = log_out
            .try_clone()
            .map_err(|e| format!("DTA log clone: {e}"))?;

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        let mut cmd = if name == "launcher.py" {
            let _ = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .and_then(|mut f| writeln!(f, "mode=launcher.py"));
            // 1) venv  2) gomulu runtime\python312-amd64  3) host pyw
            let venv_pyw = dir
                .join(".venv_jarvis")
                .join("Scripts")
                .join("pythonw.exe");
            let embed_pyw = dir
                .join("runtime")
                .join("python312-amd64")
                .join("pythonw.exe");
            let embed_py = dir
                .join("runtime")
                .join("python312-amd64")
                .join("python.exe");
            if venv_python_usable(&venv_pyw) {
                let mut c = Command::new(&venv_pyw);
                c.arg("launcher.py").current_dir(&dir);
                c
            } else if embed_pyw.is_file() {
                let mut c = Command::new(&embed_pyw);
                c.arg("launcher.py").current_dir(&dir);
                c
            } else if embed_py.is_file() {
                let mut c = Command::new(&embed_py);
                c.arg("launcher.py").current_dir(&dir);
                c
            } else if let Some((exe, pre)) = find_host_pythonw() {
                let mut c = Command::new(&exe);
                for a in &pre {
                    c.arg(a);
                }
                c.arg(path.as_os_str()).current_dir(&dir);
                c
            } else {
                return Err(
                    "DTA Python yok — kurulumda runtime\\python312-amd64 eksik. hazirla-kurulum ile paketleyin."
                        .into(),
                );
            }
        } else if name == "main.py" {
            let pyw = dir
                .join(".venv_jarvis")
                .join("Scripts")
                .join("pythonw.exe");
            if pyw.is_file() {
                let _ = fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .and_then(|mut f| writeln!(f, "mode=pythonw main.py"));
                let mut c = Command::new(&pyw);
                c.arg("main.py").current_dir(&dir);
                c
            } else {
                return Err(
                    "venv yok — launcher.py ile ilk kurulumu çalıştırın".into(),
                );
            }
        } else {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(ext.as_str(), "bat" | "cmd") {
                let file = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or_else(|| "Geçersiz dosya adı".to_string())?;
                let mut c = Command::new("cmd.exe");
                c.arg("/C")
                    .arg(format!("call \"{file}\""))
                    .current_dir(&dir);
                c
            } else if ext == "vbs" {
                let mut c = Command::new("wscript.exe");
                c.arg(path.as_os_str()).current_dir(&dir);
                c
            } else {
                let mut c = Command::new(&path);
                c.current_dir(&dir);
                c
            }
        };

        let child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_out))
            .stderr(Stdio::from(log_err))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("DTA başlatılamadı ({}) — {e}", path.display()))?;
        let pid = child.id();
        remember_owned_dta_pid(pid);
        // launcher.py splash kendi hatalarını gösterir; PID splash bitince ölür —
        // eski sağlık kontrolü yanlışlıkla CMD (VOTEX-DTA-HATA) açıyordu.
        let console_on_fail = name != "launcher.py";
        watch_launch_health(pid, log_path, console_on_fail);
        std::mem::forget(child);
        return Ok(pid);
    }

    #[cfg(not(windows))]
    {
        let _ = (path, dir);
        Err("DTA başlatma yalnızca Windows'ta desteklenir".into())
    }
}

fn dta_launch_log_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Votex").join("dta_launch.log")
}

fn chrono_stamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}

fn watch_launch_health(pid: u32, log_path: PathBuf, console_on_fail: bool) {
    // Otomatik pencere açma/kapama döngüsünü engellemek için devre dışı bırakıldı
    let _ = (pid, log_path, console_on_fail);
}

fn owned_pid_file() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA").map(PathBuf::from)?;
    Some(base.join("Votex").join("dta_owned.pid"))
}

fn remember_owned_dta_pid(pid: u32) {
    OWNED_DTA_PID.store(pid, Ordering::SeqCst);
    if let Some(path) = owned_pid_file() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, pid.to_string());
    }
}

fn clear_owned_dta_pid() {
    OWNED_DTA_PID.store(0, Ordering::SeqCst);
    if let Some(path) = owned_pid_file() {
        let _ = fs::remove_file(path);
    }
}

fn run_hidden(mut cmd: Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = cmd.creation_flags(CREATE_NO_WINDOW).output();
    }
    #[cfg(not(windows))]
    {
        let _ = cmd.output();
    }
}

fn taskkill_pid_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    run_hidden({
        let mut c = Command::new("taskkill");
        c.args(["/F", "/T", "/PID", &pid.to_string()]);
        c
    });
}

fn taskkill_by_console_title() {
    // Eski görünür konsol + hata penceresi
    for title in [OWNED_DTA_CONSOLE_TITLE, "VOTEX-DTA-HATA"] {
        run_hidden({
            let mut c = Command::new("taskkill");
            c.args([
                "/F",
                "/T",
                "/FI",
                &format!("WINDOWTITLE eq {title}*"),
            ]);
            c
        });
    }
}

fn taskkill_dta_gui() {
    // Tk penceresi: "Derin Tarama Asistan"
    for filter in [
        "WINDOWTITLE eq Derin Tarama*",
        "WINDOWTITLE eq *Derin Tarama Asistan*",
        "WINDOWTITLE eq *Derin_Tarama*",
    ] {
        run_hidden({
            let mut c = Command::new("taskkill");
            c.args(["/F", "/T", "/FI", filter]);
            c
        });
    }
}

fn kill_dta_python_from_dir() {
    let s = load_settings();
    let Ok(bat) = resolve_launch_path(&s.dta_launch_path) else {
        return;
    };
    let Some(dir) = bat.parent() else {
        return;
    };
    // PowerShell -like için tek ters eğik yeterli; escape etme
    let dir_s = dir.to_string_lossy().to_string();
    let ps = format!(
        "$d = '{}'; Get-CimInstance Win32_Process | Where-Object {{ \
            $_.Name -match 'python|pyw?' -and $_.CommandLine -and \
            ($_.CommandLine -like ('*'+$d+'*') -or \
             ($_.CommandLine -match 'main\\.py' -and $_.CommandLine -match 'surface-z|Surface-z')) \
        }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}",
        dir_s.replace('\'', "''")
    );
    run_hidden({
        let mut c = Command::new("powershell");
        c.args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &ps,
        ]);
        c
    });
}

/// VOTEX kapanırken: CMD + DTA GUI + ilgili Python süreçlerini kapat.
pub fn shutdown_owned_dta() {
    let pid = OWNED_DTA_PID.load(Ordering::SeqCst);
    let file_pid = owned_pid_file()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);

    let target = if pid != 0 { pid } else { file_pid };
    if target != 0 {
        eprintln!("[votex] shutting down owned DTA pid={target}");
        taskkill_pid_tree(target);
    }
    taskkill_by_console_title();
    taskkill_dta_gui();
    kill_dta_python_from_dir();
    clear_owned_dta_pid();
}


fn inbox_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "APPDATA bulunamadı".to_string())?;
    Ok(base.join("Votex").join("dta_inbox.json"))
}

fn dta_python(dir: &Path) -> PathBuf {
    dir.join(".venv_jarvis")
        .join("Scripts")
        .join("python.exe")
}

/// VOTEX → DTA: inbox kuyruğu + gerekirse doğrudan Python yorum.
/// Dönüş: (ok, via, message)
pub fn request_votex_interpret() -> Result<(bool, String, String), String> {
    let query = "VOTEX ekranini yorumla";
    if let Ok(path) = inbox_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let payload = serde_json::json!({
            "action": "analyze_votex",
            "query": query,
            "ts": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        });
        let _ = fs::write(&path, payload.to_string());
    }

    let s = load_settings();
    let bat = resolve_launch_path(&s.dta_launch_path)?;
    let dir = bat
        .parent()
        .ok_or_else(|| "DTA klasörü yok".to_string())?
        .to_path_buf();
    let py = dta_python(&dir);
    if !py.exists() {
        return Ok((
            true,
            "inbox".into(),
            format!(
                "DTA kuyruğuna yazıldı. DTA açıksa sesli yanıtlar. Python yok: {}",
                py.display()
            ),
        ));
    }

    let code = format!(
        "from actions.votex_vision import analyze_votex_screen; print(analyze_votex_screen({query:?}))"
    );

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = Command::new(&py)
            .current_dir(&dir)
            .args(["-c", &code])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Yorum çalıştırılamadı: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !out.status.success() && stdout.is_empty() {
            return Err(if stderr.is_empty() {
                format!("Yorum başarısız (exit {:?})", out.status.code())
            } else {
                stderr.chars().take(500).collect()
            });
        }
        let msg = if stdout.is_empty() { stderr } else { stdout };
        return Ok((true, "python".into(), msg.chars().take(4000).collect()));
    }

    #[cfg(not(windows))]
    {
        let _ = (py, code, dir);
        Ok((true, "inbox".into(), "Kuyruğa yazıldı".into()))
    }
}


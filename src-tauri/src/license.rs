//! DFT ortak lisans — HMAC doğrulama + yükleme kotası (%APPDATA%\DFT).

use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

type HmacSha256 = Hmac<Sha256>;

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

const PRODUCT_FAMILY: &str = "dft_elic_votex";
const VERIFY_SEED: &[u8] = b"ELIC-Asistan-SIGN-v1-surface-z";

fn verify_key() -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(VERIFY_SEED);
    let out = h.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&out);
    key
}

fn dft_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let p = base.join("DFT");
    let _ = fs::create_dir_all(&p);
    p
}

fn license_path() -> PathBuf {
    dft_dir().join("license.dat")
}

fn usage_path() -> PathBuf {
    dft_dir().join("usage.json")
}

fn policy_path() -> PathBuf {
    dft_dir().join("license_policy.json")
}

fn canonical_json(v: &serde_json::Value) -> String {
    // sort_keys via BTreeMap flatten — payload object only
    match v {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().cloned().collect();
            keys.sort();
            let mut parts = Vec::new();
            for k in keys {
                let val = &map[&k];
                parts.push(format!(
                    "{}:{}",
                    serde_json::to_string(&k).unwrap_or_default(),
                    serde_json::to_string(val).unwrap_or_default()
                ));
            }
            format!("{{{}}}", parts.join(","))
        }
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

/// Python json.dumps(sort_keys=True, separators=(',', ':')) — iç içe nesneler dahil
fn canonical_json_value(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => "null".into(),
        serde_json::Value::Bool(b) => {
            if *b {
                "true".into()
            } else {
                "false".into()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => serde_json::to_string(s).unwrap_or_default(),
        serde_json::Value::Array(arr) => {
            let parts: Vec<String> = arr.iter().map(canonical_json_value).collect();
            format!("[{}]", parts.join(","))
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().cloned().collect();
            keys.sort();
            let mut out = String::from("{");
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).unwrap_or_default());
                out.push(':');
                out.push_str(&canonical_json_value(&map[k]));
            }
            out.push('}');
            out
        }
    }
}

fn canonical_json_py(payload: &serde_json::Map<String, serde_json::Value>) -> String {
    canonical_json_value(&serde_json::Value::Object(payload.clone()))
}

fn ensure_policy_file() {
    let path = policy_path();
    if path.exists() {
        return;
    }
    let body = serde_json::json!({
        "enforce": true,
        "product_family": PRODUCT_FAMILY,
        "default_plan": "demo",
    });
    if let Ok(s) = serde_json::to_string_pretty(&body) {
        let _ = fs::write(path, s);
    }
}

pub fn is_enforcement_enabled() -> bool {
    ensure_policy_file();
    if let Ok(v) = std::env::var("DFT_LICENSE_ENFORCE") {
        let t = v.trim().to_ascii_lowercase();
        if matches!(t.as_str(), "1" | "true" | "yes" | "on") {
            return true;
        }
        if matches!(t.as_str(), "0" | "false" | "no" | "off") {
            return false;
        }
    }
    if let Ok(raw) = fs::read_to_string(policy_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            return v.get("enforce").and_then(|x| x.as_bool()).unwrap_or(true);
        }
    }
    true
}

fn get_hwid_hash() -> String {
    use std::sync::OnceLock;
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED
        .get_or_init(|| get_hwid_hash_uncached())
        .clone()
}

fn get_hwid_hash_uncached() -> String {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // reg.exe — PowerShell'den hizli; UI'yi kilitlemesin
        let out = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let guid = out
            .ok()
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout);
                s.lines()
                    .find(|l| l.contains("MachineGuid"))
                    .and_then(|l| l.split_whitespace().last())
                    .map(|g| g.trim().to_string())
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "no-guid".into());
        // Python platform.node() genelde kucuk harf; COMPUTERNAME buyuk — normalize
        let host = std::env::var("COMPUTERNAME")
            .unwrap_or_else(|_| "unknown".into())
            .to_ascii_lowercase();
        let blob = format!("host={host}|machine_guid={guid}|system=Windows");
        let mut h = Sha256::new();
        h.update(blob.as_bytes());
        return to_hex(h.finalize().as_slice());
    }
    #[cfg(not(windows))]
    {
        let mut h = Sha256::new();
        h.update(b"host=unknown|machine_guid=no-guid|system=");
        to_hex(h.finalize().as_slice())
    }
}

fn get_hwid_short() -> String {
    get_hwid_hash()
        .chars()
        .take(16)
        .collect::<String>()
        .to_uppercase()
}

pub fn verify_license_token(token: &str) -> Option<serde_json::Map<String, serde_json::Value>> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    let pad = (4 - token.len() % 4) % 4;
    let padded = format!("{}{}", token, "=".repeat(pad));
    let raw = base64_url_decode(&padded)?;
    let envelope: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let payload = envelope.get("payload")?.as_object()?.clone();
    let sig = envelope.get("sig")?.as_str()?.to_string();
    let body = canonical_json_py(&payload);
    let mut mac = HmacSha256::new_from_slice(&verify_key()).ok()?;
    mac.update(body.as_bytes());
    let expected = to_hex(mac.finalize().into_bytes().as_slice());
    if !constant_time_eq(expected.as_bytes(), sig.as_bytes()) {
        return None;
    }
    Some(payload)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn base64_url_decode(s: &str) -> Option<Vec<u8>> {
    use base64::{engine::general_purpose::URL_SAFE, Engine};
    URL_SAFE.decode(s).ok()
}

fn base64_url_encode_no_pad(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(bytes)
}

fn sign_license_payload(payload: &serde_json::Map<String, serde_json::Value>) -> String {
    let body = canonical_json_py(payload);
    let mut mac = HmacSha256::new_from_slice(&verify_key()).expect("hmac key");
    mac.update(body.as_bytes());
    let sig = to_hex(mac.finalize().into_bytes().as_slice());
    let envelope = serde_json::json!({
        "payload": payload,
        "sig": sig,
    });
    let raw = serde_json::to_string(&envelope).unwrap_or_default();
    base64_url_encode_no_pad(raw.as_bytes())
}

fn days_to_civil(z: i64) -> (i32, u32, u32) {
    // Howard Hinnant — days since Unix epoch → Y-M-D
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

fn unix_to_iso(secs: i64) -> String {
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let h = rem / 3600;
    let mi = (rem % 3600) / 60;
    let s = rem % 60;
    let (y, mo, d) = days_to_civil(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}")
}

/// Lisans yoksa bu cihaza 7 günlük demo yazar.
fn ensure_first_run_demo() -> bool {
    if let Ok(token) = fs::read_to_string(license_path()) {
        if verify_license_token(&token).is_some() {
            return false;
        }
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let expires = now + 7 * 86400;
    let mut features = serde_json::Map::new();
    features.insert("analyze".into(), serde_json::json!(true));
    features.insert("survey".into(), serde_json::json!(true));
    features.insert("navigation".into(), serde_json::json!(false));
    features.insert("thermal".into(), serde_json::json!(false));
    features.insert("max_corners".into(), serde_json::json!(2));
    features.insert("daily_analyze_limit".into(), serde_json::json!(15));
    features.insert("max_uploads".into(), serde_json::json!(50));

    let mut payload = serde_json::Map::new();
    payload.insert("plan".into(), serde_json::json!("demo"));
    payload.insert("mode".into(), serde_json::json!("demo"));
    payload.insert("hwid".into(), serde_json::json!(get_hwid_hash()));
    payload.insert("issued_at".into(), serde_json::json!(unix_to_iso(now)));
    payload.insert("expires_at".into(), serde_json::json!(unix_to_iso(expires)));
    payload.insert("customer".into(), serde_json::json!("demo"));
    payload.insert("features".into(), serde_json::Value::Object(features));
    payload.insert("product".into(), serde_json::json!("DFT ELIC + VOTEX"));
    payload.insert("product_family".into(), serde_json::json!(PRODUCT_FAMILY));
    payload.insert("version".into(), serde_json::json!(2));
    payload.insert("auto_demo".into(), serde_json::json!(true));

    let token = sign_license_payload(&payload);
    let _ = fs::write(license_path(), &token);
    let mut usage = load_usage();
    usage.uploads = 0;
    save_usage(&usage);
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageFile {
    #[serde(default)]
    pub uploads: u64,
    /// Demo dosya kredisi (max_uploads üzerine eklenir).
    #[serde(default)]
    pub bonus_uploads: u64,
    /// Demo gün kredisi (expires_at üzerine eklenir; dosya kredisi gibi tek kullanımlık).
    #[serde(default)]
    pub bonus_days: u64,
    /// Tek kullanımlık kredi kodları (credit_id / day_credit_id).
    #[serde(default)]
    pub redeemed_credit_ids: Vec<String>,
    #[serde(default)]
    pub daily: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub last_seen: String,
}

fn load_usage() -> UsageFile {
    fs::read_to_string(usage_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_usage(u: &UsageFile) {
    if let Ok(s) = serde_json::to_string_pretty(u) {
        let _ = fs::write(usage_path(), s);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub valid: bool,
    pub plan: String,
    pub message: String,
    /// Tam makine kodu (üreticiye iletilir; lisans buna kilitlenir)
    pub hwid: String,
    pub hwid_short: String,
    pub days_left: i64,
    pub is_demo: bool,
    pub enforce: bool,
    pub uploads_used: u64,
    pub uploads_limit: u64,
    pub customer: String,
}

fn features_uploads_limit(payload: &serde_json::Map<String, serde_json::Value>) -> u64 {
    payload
        .get("features")
        .and_then(|f| f.get("max_uploads"))
        .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|i| i as u64)))
        .unwrap_or(0)
}

/// Plan limiti + kullanım dosyasındaki bonus kredi.
fn effective_uploads_limit(base: u64, usage: &UsageFile) -> u64 {
    if base == 0 {
        return 0; // sınırsız plan
    }
    base.saturating_add(usage.bonus_uploads)
}

fn is_credit_payload(payload: &serde_json::Map<String, serde_json::Value>) -> bool {
    let mode = payload
        .get("mode")
        .or_else(|| payload.get("plan"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    mode.eq_ignore_ascii_case("credit") || mode.eq_ignore_ascii_case("kredi")
}

fn is_day_credit_payload(payload: &serde_json::Map<String, serde_json::Value>) -> bool {
    let mode = payload
        .get("mode")
        .or_else(|| payload.get("plan"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    matches!(
        mode.to_ascii_lowercase().as_str(),
        "day_credit" | "daycredit" | "demo_days" | "gun" | "gün" | "days"
    )
}

fn credit_amount(payload: &serde_json::Map<String, serde_json::Value>) -> u64 {
    payload
        .get("credits")
        .or_else(|| payload.get("add_uploads"))
        .or_else(|| payload.get("bonus"))
        .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|i| i.max(0) as u64)))
        .unwrap_or(50)
        .clamp(1, 5000)
}

fn day_credit_amount(payload: &serde_json::Map<String, serde_json::Value>) -> u64 {
    payload
        .get("days")
        .or_else(|| payload.get("add_days"))
        .or_else(|| payload.get("bonus_days"))
        .or_else(|| payload.get("credits"))
        .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|i| i.max(0) as u64)))
        .unwrap_or(7)
        .clamp(1, 3650)
}

fn credit_id_of(payload: &serde_json::Map<String, serde_json::Value>) -> String {
    payload
        .get("credit_id")
        .or_else(|| payload.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let body = canonical_json_py(payload);
            let mut h = Sha256::new();
            h.update(body.as_bytes());
            to_hex(h.finalize().as_slice()).chars().take(24).collect()
        })
}

fn push_redeemed_id(usage: &mut UsageFile, credit_id: String) -> Result<(), String> {
    if usage.redeemed_credit_ids.iter().any(|id| id == &credit_id) {
        return Err("Bu kredi kodu daha önce kullanılmış.".into());
    }
    usage.redeemed_credit_ids.push(credit_id);
    if usage.redeemed_credit_ids.len() > 200 {
        let n = usage.redeemed_credit_ids.len();
        usage.redeemed_credit_ids = usage.redeemed_credit_ids.split_off(n - 200);
    }
    Ok(())
}

fn redeem_credit_token(
    payload: &serde_json::Map<String, serde_json::Value>,
) -> Result<LicenseStatus, String> {
    if let Some(fam) = payload.get("product_family").and_then(|v| v.as_str()) {
        if !fam.is_empty() && fam != PRODUCT_FAMILY {
            return Err(format!("Ürün ailesi uyuşmuyor ({fam})"));
        }
    }
    let hwid = payload
        .get("hwid")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !hwid.is_empty() && hwid != get_hwid_hash() {
        return Err(format!(
            "Kredi bu cihaza ait değil. Cihaz ID: {}",
            get_hwid_short()
        ));
    }
    let credits = credit_amount(payload);
    let credit_id = credit_id_of(payload);

    let mut usage = load_usage();
    push_redeemed_id(&mut usage, credit_id)?;
    usage.bonus_uploads = usage.bonus_uploads.saturating_add(credits);
    save_usage(&usage);

    let mut st = get_license_status();
    st.message = format!(
        "Kredi eklendi: +{} dosya. Hak: {}/{}.",
        credits, st.uploads_used, st.uploads_limit
    );
    Ok(st)
}

fn redeem_day_credit_token(
    payload: &serde_json::Map<String, serde_json::Value>,
) -> Result<LicenseStatus, String> {
    if let Some(fam) = payload.get("product_family").and_then(|v| v.as_str()) {
        if !fam.is_empty() && fam != PRODUCT_FAMILY {
            return Err(format!("Ürün ailesi uyuşmuyor ({fam})"));
        }
    }
    let hwid = payload
        .get("hwid")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !hwid.is_empty() && hwid != get_hwid_hash() {
        return Err(format!(
            "Gün kredisi bu cihaza ait değil. Cihaz ID: {}",
            get_hwid_short()
        ));
    }
    let days = day_credit_amount(payload);
    let credit_id = credit_id_of(payload);

    let mut usage = load_usage();
    push_redeemed_id(&mut usage, credit_id)?;
    usage.bonus_days = usage.bonus_days.saturating_add(days);
    save_usage(&usage);

    let mut st = get_license_status();
    st.message = format!(
        "Gün kredisi eklendi: +{} gün. Kalan: {} gün.",
        days, st.days_left
    );
    Ok(st)
}

fn plan_of(payload: &serde_json::Map<String, serde_json::Value>) -> String {
    let raw = payload
        .get("plan")
        .or_else(|| payload.get("mode"))
        .and_then(|v| v.as_str())
        .unwrap_or("demo");
    match raw {
        "trial" => "demo".into(),
        "full" | "oem" => "y1".into(),
        other => other.to_string(),
    }
}

pub fn get_license_status() -> LicenseStatus {
    let enforce = is_enforcement_enabled();
    let usage = load_usage();
    if !enforce {
        return LicenseStatus {
            valid: true,
            plan: "dev".into(),
            message: "Geliştirme — lisans kapalı".into(),
            hwid: get_hwid_hash(),
            hwid_short: "DEV".into(),
            days_left: 999999,
            is_demo: false,
            enforce: false,
            uploads_used: usage.uploads,
            uploads_limit: 0,
            customer: "dev".into(),
        };
    }

    // İlk açılış: otomatik 7 günlük demo
    ensure_first_run_demo();
    let usage = load_usage();

    let token = fs::read_to_string(license_path()).unwrap_or_default();
    let Some(payload) = verify_license_token(&token) else {
        return LicenseStatus {
            valid: false,
            plan: "none".into(),
            message: "Lisans bulunamadı. Aktivasyon kodu girin.".into(),
            hwid: get_hwid_hash(),
            hwid_short: get_hwid_short(),
            days_left: 0,
            is_demo: false,
            enforce: true,
            uploads_used: usage.uploads,
            uploads_limit: 0,
            customer: String::new(),
        };
    };

    if let Some(fam) = payload.get("product_family").and_then(|v| v.as_str()) {
        if !fam.is_empty() && fam != PRODUCT_FAMILY {
            return LicenseStatus {
                valid: false,
                plan: "invalid".into(),
                message: format!("Ürün ailesi uyuşmuyor ({fam})"),
                hwid: get_hwid_hash(),
                hwid_short: get_hwid_short(),
                days_left: 0,
                is_demo: false,
                enforce: true,
                uploads_used: usage.uploads,
                uploads_limit: 0,
                customer: String::new(),
            };
        }
    }

    let hwid = payload
        .get("hwid")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if hwid != get_hwid_hash() {
        return LicenseStatus {
            valid: false,
            plan: "invalid_hwid".into(),
            message: "Lisans başka cihaza bağlı.".into(),
            hwid: get_hwid_hash(),
            hwid_short: get_hwid_short(),
            days_left: 0,
            is_demo: false,
            enforce: true,
            uploads_used: usage.uploads,
            uploads_limit: features_uploads_limit(&payload),
            customer: payload
                .get("customer")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
        };
    }

    let plan = plan_of(&payload);
    let base_limit = features_uploads_limit(&payload);
    let limit = effective_uploads_limit(base_limit, &usage);
    let is_demo = plan == "demo";
    let customer = payload
        .get("customer")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // expires_at (imzalı) + usage.bonus_days (gün kredisi) → kalan gün
    let signed_left = match payload.get("expires_at").and_then(|v| v.as_str()) {
        Some(s) => chrono_parse_days_left_signed(s).unwrap_or(0),
        None => 0, // süresiz plan → bonus yine eklenir ama expired sayılmaz
    };
    let has_expiry = payload.get("expires_at").and_then(|v| v.as_str()).is_some();
    let effective_left = signed_left + usage.bonus_days as i64;
    let days_left = effective_left.max(0);
    let expired = has_expiry && effective_left < 0;

    if expired {
        return LicenseStatus {
            valid: false,
            plan,
            message: "Lisans süresi doldu.".into(),
            hwid: get_hwid_hash(),
            hwid_short: get_hwid_short(),
            days_left: 0,
            is_demo,
            enforce: true,
            uploads_used: usage.uploads,
            uploads_limit: limit,
            customer,
        };
    }

    LicenseStatus {
        valid: true,
        plan,
        message: "OK".into(),
        hwid: get_hwid_hash(),
        hwid_short: get_hwid_short(),
        days_left: if has_expiry { days_left } else { 999999 },
        is_demo,
        enforce: true,
        uploads_used: usage.uploads,
        uploads_limit: limit,
        customer,
    }
}

fn chrono_parse_days_left(iso: &str) -> Option<(i64, bool)> {
    let left = chrono_parse_days_left_signed(iso)?;
    Some((left.max(0), left < 0))
}

/// Kalan gün (negatif = süresi geçmiş). Gün kredisi eklenmeden önce kullanılır.
fn chrono_parse_days_left_signed(iso: &str) -> Option<i64> {
    // Basit: YYYY-MM-DDTHH:MM:SS — SystemTime karşılaştırması yerine gün farkı
    let date = iso.get(0..10)?;
    let parts: Vec<_> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let exp_days = civil_to_days(y, m, d)?;
    let now_days = (now / 86400) as i64;
    Some(exp_days - now_days + 1)
}

fn civil_to_days(y: i32, m: u32, d: u32) -> Option<i64> {
    // Howard Hinnant algorithms (civil to days)
    let y = y as i64;
    let m = m as i64;
    let d = d as i64;
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe - 719468)
}

pub fn activate_license(token: &str) -> Result<LicenseStatus, String> {
    let payload = verify_license_token(token).ok_or("Geçersiz veya bozuk lisans/kredi kodu.")?;
    if is_day_credit_payload(&payload) {
        return redeem_day_credit_token(&payload);
    }
    if is_credit_payload(&payload) {
        return redeem_credit_token(&payload);
    }
    let hwid = payload
        .get("hwid")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if hwid != get_hwid_hash() {
        return Err(format!(
            "Lisans bu cihaza ait değil. Cihaz ID: {}",
            get_hwid_short()
        ));
    }
    fs::write(license_path(), token.trim()).map_err(|e| e.to_string())?;
    Ok(get_license_status())
}

pub fn check_and_record_upload() -> Result<LicenseStatus, String> {
    let st = get_license_status();
    if !st.enforce {
        return Ok(st);
    }
    if !st.valid {
        return Err(st.message);
    }
    if st.uploads_limit > 0 && st.uploads_used >= st.uploads_limit {
        return Err(format!(
            "Demo dosya limiti doldu ({}/{}).",
            st.uploads_used, st.uploads_limit
        ));
    }
    let mut usage = load_usage();
    usage.uploads = usage.uploads.saturating_add(1);
    save_usage(&usage);
    Ok(get_license_status())
}

#[allow(dead_code)]
fn _canonical_unused() {
    let _ = canonical_json(&serde_json::json!({}));
}

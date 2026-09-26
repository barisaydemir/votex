//! VotexProb — localhost hesap motoru (127.0.0.1:18766).
//! Faz A: health + policy + decide stub.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::net::TcpListener;
use std::sync::RwLock;

use votex_prob::api;
use votex_prob::http;
use votex_prob::policy::PolicyState;
use votex_prob::schema::ENGINE_VERSION;

pub const ADDR: &str = "127.0.0.1:18766";

fn main() {
    let policy = RwLock::new(PolicyState::default());
    eprintln!("[VotexProb] {ENGINE_VERSION} listening on http://{ADDR}");
    let listener = match TcpListener::bind(ADDR) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[VotexProb] bind failed ({ADDR}): {e}");
            std::process::exit(1);
        }
    };
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let _ = handle_connection(s, &policy);
            }
            Err(e) => eprintln!("[VotexProb] accept: {e}"),
        }
    }
}

fn handle_connection(
    mut stream: std::net::TcpStream,
    policy: &RwLock<PolicyState>,
) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    // Paylaşılan katman: parçalı segment + erken kopma güvenli okuma ve
    // bayt-sayılı Content-Length (dta_bridge'teki 0.4.157 düzeltmeleriyle aynı).
    let buf = http::read_request(&mut stream)?;
    if buf.is_empty() {
        return Ok(());
    }
    let raw = String::from_utf8_lossy(&buf).into_owned();
    let (status, body) = api::dispatch(&raw, policy);
    let resp = http::response_bytes(&status, &body);
    stream.write_all(&resp).map_err(|e| e.to_string())?;
    Ok(())
}

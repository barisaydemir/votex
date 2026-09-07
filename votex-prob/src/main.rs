//! VotexProb — localhost hesap motoru (127.0.0.1:18766).
//! Faz A: health + policy + decide stub.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::RwLock;

use votex_prob::api;
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
    let mut buf = vec![0u8; 1 << 20];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    if n == 0 {
        return Ok(());
    }
    let raw = String::from_utf8_lossy(&buf[..n]);
    let (status, body) = api::dispatch(&raw, policy);
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(resp.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

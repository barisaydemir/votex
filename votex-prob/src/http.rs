//! Paylaşılan mini HTTP katmanı — VOTEX (127.0.0.1:18765) ve VotexProb
//! (127.0.0.1:18766) köprüleri aynı okuma/yanıt kurallarını kullanır.
//!
//! Tarihçe: tek `read()` yarım HTTP isteğini yakalayıp yanıtsız kapanmaya ve
//! `Content-Length`'in karakter sayısıyla bildirilmesi çok baytlı UTF-8
//! gövdede kırpık yanıtlara yol açıyordu (0.4.157'de dta_bridge'te düzeltildi;
//! 0.4.160'ta her iki köprüye ortak modül olarak taşındı).

use std::io::{Read, Write};

/// İsteği başlık sonu (`\r\n\r\n`) + Content-Length tamamlanana kadar okur.
/// İstemci erken kapandıysa eldeki baytlarla döner; asla sonsuza dek beklemez.
pub fn read_request<R: Read>(stream: &mut R) -> Result<Vec<u8>, String> {
    // İstek TCP'de birden çok segmentte gelebilir (başlık + gövde ayrı ayrı);
    // tek read() yarım isteği yakalayıp yanıtsız kapanmaya yol açıyordu.
    let mut buf: Vec<u8> = Vec::with_capacity(65536);
    let mut tmp = [0u8; 16384];
    loop {
        let n = stream.read(&mut tmp).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 1024 * 1024 {
            break; // güvenlik sınırı
        }
    }
    // Content-Length kadar gövdeyi tamamla
    let header_end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|p| p + 4)
        .unwrap_or(buf.len());
    let headers_text = String::from_utf8_lossy(&buf[..header_end]);
    let content_length: usize = headers_text
        .lines()
        .find_map(|l| {
            let (k, v) = l.split_once(':')?;
            if k.trim().eq_ignore_ascii_case("content-length") {
                v.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    while buf.len() < header_end + content_length {
        let n = stream.read(&mut tmp).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
    }
    Ok(buf)
}

/// İstek satırı + başlık + gövde ayrıştırıcı; `\n\n` fallback'ini de kabul eder.
pub fn parse_http(raw: &str) -> Result<(String, String, &str), String> {
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .or_else(|| raw.split_once("\n\n"))
        .ok_or_else(|| "invalid HTTP".to_string())?;
    let first = head.lines().next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let path = parts
        .next()
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    Ok((method, path, body))
}

pub fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    }
}

/// Yanıt başlığı; Content-Length BAYT sayısıdır — karakter sayısı çok
/// baytlı UTF-8'de kırpık yanıt üretiyordu.
pub fn response_header(status: u16, body: &str) -> String {
    response_header_line(
        &format!("HTTP/1.1 {} {}", status, reason_phrase(status)),
        body,
    )
}

/// Durum satırını metinle alan varyant ("200 OK" gibi).
pub fn response_header_line(status_line: &str, body: &str) -> String {
    format!(
        "{status_line}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.as_bytes().len()
    )
}

/// Yanıtı (başlık + gövde) tek arabellek olarak üretir.
pub fn response_bytes(status_line: &str, body: &str) -> Vec<u8> {
    let mut out = response_header_line(status_line, body).into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

pub fn write_response<W: Write>(
    stream: &mut W,
    status: u16,
    body: &str,
) -> Result<(), String> {
    let header = response_header(status, body);
    stream
        .write_all(header.as_bytes())
        .and_then(|_| stream.write_all(body.as_bytes()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Shutdown, TcpListener, TcpStream};
    use std::time::Duration;

    fn socket_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = TcpStream::connect(addr).unwrap();
        let (server, _) = listener.accept().unwrap();
        (client, server)
    }

    #[test]
    fn read_request_completes_body_across_split_segments() {
        let (mut client, mut server) = socket_pair();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let body = r#"{"text":"iki parça gövde"}"#;
        let payload = format!(
            "POST /v1/decide HTTP/1.1\r\nContent-Length: {}\r\n\r\n{}",
            body.as_bytes().len(),
            body
        )
        .into_bytes();
        let split = payload.len() - body.len() / 2;
        client.write_all(&payload[..split]).unwrap();
        client.flush().unwrap();
        std::thread::sleep(Duration::from_millis(50));
        client.write_all(&payload[split..]).unwrap();
        client.flush().unwrap();
        let buf = read_request(&mut server).unwrap();
        let raw = String::from_utf8_lossy(&buf);
        assert!(raw.ends_with(body), "gövde eksiksiz toplanmalı: {raw:?}");
    }

    #[test]
    fn read_request_early_client_close_returns_partial() {
        let (mut client, mut server) = socket_pair();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        client
            .write_all(b"POST /v1/decide HTTP/1.1\r\nContent-Length: 100\r\n\r\n{\"part\":")
            .unwrap();
        client.flush().unwrap();
        client.shutdown(Shutdown::Both).unwrap();
        let buf = read_request(&mut server).unwrap(); // asılmadan dönmeli
        assert!(!buf.is_empty());
    }

    #[test]
    fn read_request_immediate_close_returns_empty() {
        let (client, mut server) = socket_pair();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        client.shutdown(Shutdown::Both).unwrap();
        assert!(read_request(&mut server).unwrap().is_empty());
    }

    #[test]
    fn content_length_counts_bytes_not_chars() {
        let body = "şı — Türkçe çok baytlı gövde";
        let header = response_header(200, body);
        assert!(header.contains(&format!("Content-Length: {}", body.as_bytes().len())));
        assert_ne!(body.as_bytes().len(), body.chars().count());
        assert!(!header.contains(&format!("Content-Length: {}", body.chars().count())));
    }

    #[test]
    fn response_bytes_pairs_header_and_body() {
        let body = "{\"ok\":true}";
        // VotexProb api::dispatch "200 OK" biçiminde durum satırı döndürür.
        let bytes = response_bytes("200 OK", body);
        let raw = String::from_utf8(bytes).unwrap();
        assert!(raw.starts_with("200 OK\r\n"));
        assert!(raw.ends_with(body));
        let cl: usize = raw
            .lines()
            .find_map(|l| l.strip_prefix("Content-Length: ")?.parse().ok())
            .unwrap();
        assert_eq!(cl, body.as_bytes().len());
    }

    #[test]
    fn parse_http_strips_query_and_supports_bare_lf() {
        let (m, p, b) = parse_http("GET /x?cursor=3 HTTP/1.1\r\nHost: y\r\n\r\n").unwrap();
        assert_eq!((m.as_str(), p.as_str(), b), ("GET", "/x", ""));
        let (m, p, b) = parse_http("POST /z HTTP/1.1\n\nselam").unwrap();
        assert_eq!((m.as_str(), p.as_str(), b), ("POST", "/z", "selam"));
    }
}

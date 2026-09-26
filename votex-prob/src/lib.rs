//! VotexProb — localhost hesap motoru (127.0.0.1:18766).
//! Paylaşılan kütüphane; `VotexProb` binary'si bu modülleri kullanır.
//! L2–L5 karar katmanları (`decide`) diğer crates'lerden test edilebilir.

pub mod api;
pub mod decide;
pub mod http;
pub mod policy;
pub mod schema;

//! Legacy3DMagDevice — dik çekim JSON → anomali / olası yapı şekilleri.
//!
//! ELIC colormap ve CSV nokta-bulutu yolundan ayrıdır.
//! `x,y,z` = manyetik bileşenler; konum = `x_coords` / `y_coords` (metre).

mod types;
mod parse;
mod level;
mod analyze;
mod invert;

pub use types::*;
pub use parse::looks_like_legacy_dik;
pub use level::level_legacy_mag_json;
pub use analyze::analyze_legacy_dik_with_options;

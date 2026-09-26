//! Manyetik sensör (fluxgate / gradiyometre) analiz alt sistemi.
//!
//! Veri yolu:
//! ham dizi → filtre (MA / histerezis) → kalibrasyon (nötr zemin)
//! → asimetrik normalizasyon → bipolar colormap → sınıflandırma.

mod analyzer;
mod calibration;
mod colormap;
mod filter;
mod types;

pub use analyzer::MagneticAnalyzer;
pub use calibration::{resolve_ground, AsymmetricRange};
pub use colormap::{legend_color, map_signed_norm, value_to_color};
pub use filter::{HysteresisFilter, MovingAverage, NoiseFilterChain};
pub use types::{
    AnomalyClass, AnomalyPoint, CalibrationMode, ColorPalette, MagneticConfig, Rgba,
};

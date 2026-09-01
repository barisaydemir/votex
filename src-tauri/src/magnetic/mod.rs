//! Manyetik sensör (fluxgate / gradiyometre) analiz alt sistemi.

mod analyzer;
mod calibration;
mod colormap;
mod filter;
mod types;

pub use analyzer::MagneticAnalyzer;
#[allow(unused_imports)]
pub use filter::{HysteresisFilter, MovingAverage, NoiseFilterChain};
pub use types::{
    AnomalyClass, AnomalyPoint, CalibrationMode, MagneticConfig, Rgba,
};

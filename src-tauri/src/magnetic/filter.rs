//! Sensör gürültüsü (jitter) filtreleri.

/// Basit hareketli ortalama (ring buffer, O(1) güncelleme).
#[derive(Debug, Clone)]
pub struct MovingAverage {
    buf: Vec<f32>,
    sum: f64,
    idx: usize,
    filled: usize,
    capacity: usize,
}

impl MovingAverage {
    pub fn new(window: usize) -> Self {
        let capacity = window.max(1);
        Self {
            buf: vec![0.0; capacity],
            sum: 0.0,
            idx: 0,
            filled: 0,
            capacity,
        }
    }

    pub fn reset(&mut self) {
        self.buf.fill(0.0);
        self.sum = 0.0;
        self.idx = 0;
        self.filled = 0;
    }

    pub fn push(&mut self, value: f32) -> f32 {
        if self.capacity == 1 {
            return value;
        }
        if self.filled == self.capacity {
            self.sum -= self.buf[self.idx] as f64;
        } else {
            self.filled += 1;
        }
        self.buf[self.idx] = value;
        self.sum += value as f64;
        self.idx = (self.idx + 1) % self.capacity;
        (self.sum / self.filled as f64) as f32
    }

    /// Dizi üzerinde kayan pencere (batch).
    pub fn apply_series(window: usize, samples: &[f32]) -> Vec<f32> {
        let mut ma = Self::new(window);
        samples.iter().map(|&v| ma.push(v)).collect()
    }
}

/// Histerezis / deadband: küçük salınımları son kararlı değerde tutar.
///
/// `|yeni − son| < deadband` ise önceki değer korunur → yeşil zeminde titreme azalır.
#[derive(Debug, Clone)]
pub struct HysteresisFilter {
    deadband: f32,
    last: Option<f32>,
}

impl HysteresisFilter {
    pub fn new(deadband: f32) -> Self {
        Self {
            deadband: deadband.max(0.0),
            last: None,
        }
    }

    pub fn reset(&mut self) {
        self.last = None;
    }

    pub fn push(&mut self, value: f32) -> f32 {
        let out = match self.last {
            None => value,
            Some(prev) if (value - prev).abs() < self.deadband => prev,
            Some(_) => value,
        };
        self.last = Some(out);
        out
    }

    pub fn apply_series(deadband: f32, samples: &[f32]) -> Vec<f32> {
        let mut h = Self::new(deadband);
        samples.iter().map(|&v| h.push(v)).collect()
    }
}

/// Önce MA, sonra histerezis — canlı akış için birleşik zincir.
#[derive(Debug, Clone)]
pub struct NoiseFilterChain {
    ma: MovingAverage,
    hyst: HysteresisFilter,
}

impl NoiseFilterChain {
    pub fn new(ma_window: usize, deadband: f32) -> Self {
        Self {
            ma: MovingAverage::new(ma_window),
            hyst: HysteresisFilter::new(deadband),
        }
    }

    pub fn reset(&mut self) {
        self.ma.reset();
        self.hyst.reset();
    }

    pub fn push(&mut self, value: f32) -> f32 {
        let smoothed = self.ma.push(value);
        self.hyst.push(smoothed)
    }

    pub fn apply_series(ma_window: usize, deadband: f32, samples: &[f32]) -> Vec<f32> {
        let mut chain = Self::new(ma_window, deadband);
        samples.iter().map(|&v| chain.push(v)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_average_smooths_spike() {
        let out = MovingAverage::apply_series(3, &[0.0, 0.0, 100.0, 0.0, 0.0]);
        assert!(out[2] < 100.0);
        assert!(out[2] > 0.0);
    }

    #[test]
    fn hysteresis_holds_small_jitter() {
        let mut h = HysteresisFilter::new(10.0);
        assert!((h.push(100.0) - 100.0).abs() < 1e-5);
        assert!((h.push(105.0) - 100.0).abs() < 1e-5); // deadband içinde
        assert!((h.push(120.0) - 120.0).abs() < 1e-5); // aştı
    }
}

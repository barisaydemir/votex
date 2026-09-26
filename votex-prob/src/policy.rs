//! Policy profiles: standard | corridor.

#[derive(Debug, Clone)]
pub struct PolicyState {
    pub policy_id: String,
}

impl Default for PolicyState {
    fn default() -> Self {
        Self {
            policy_id: "standard".into(),
        }
    }
}

pub fn normalize_policy(id: &str) -> String {
    match id.trim().to_ascii_lowercase().as_str() {
        "corridor" | "koridor" => "corridor".into(),
        _ => "standard".into(),
    }
}

//! Faz B — gerçek decide motoru (L2–L5).

mod depth;
/// L5 oda–oda bağlantı — legacy `validate::link_chambers_with_path` ile parite test edilir.
pub mod link;
/// L5 metal host kararı — corridor host yarıçapı farkı test edilir.
pub mod metal;
/// L2 sınıf skorları — legacy `classify` ile parite test edilir.
pub mod score;

use std::collections::HashMap;

use crate::policy::normalize_policy;
use crate::schema::{
    DecisionBatch, DecisionReport, DepthDecision, EvidenceBatch, VoidDecision, ENGINE_VERSION,
    SCHEMA_VERSION,
};

use depth::estimate_depth;
use link::link_rooms;
use metal::decide_metals;
use score::score_void;

pub fn decide(batch: &EvidenceBatch, fallback_policy: &str) -> DecisionBatch {
    let policy_id = batch
        .policy_id
        .as_deref()
        .map(normalize_policy)
        .unwrap_or_else(|| normalize_policy(fallback_policy));
    let side = batch.view_mode.eq_ignore_ascii_case("side");
    let target = normalize_target(&batch.target);
    let min_conf = batch.min_confidence.clamp(0.15, 0.9);
    let corridor = policy_id == "corridor";

    let mut voids = Vec::new();
    let mut depths = Vec::new();
    let mut by_class: HashMap<String, u32> = HashMap::new();
    let mut accepted = 0u32;
    let mut rejected = 0u32;
    let mut room_slots: Vec<RoomSlot> = Vec::new();

    let snr_gate = if batch.deep { 1.05 } else { 1.35 };
    for b in &batch.void_blobs {
        let snr = if b.snr > 0.0 {
            b.snr
        } else {
            b.intensity / 0.06
        };
        // Derin mod: legacy extract_validated snr_gate ile birebir (1.05). Kapıyı
        // eşitlemeyen engine, zayıf sinyalleri (snr 1.05..1.35) reddedip legacy'den
        // farklı karar verirdi — pipeline parite testi deep modunda bunu doğrular.
        if snr < snr_gate {
            rejected += 1;
            voids.push(VoidDecision {
                id: b.id.clone(),
                class: "noise".into(),
                conf: 0.0,
                raw_conf: 0.0,
                margin: 0.0,
                action: "reject".into(),
                rewrite_to: None,
                reasons: vec!["snr_low".into()],
            });
            continue;
        }

        let (mut class, mut conf, margin, mut reasons) = score_void(
            b,
            side,
            batch.map_width_m,
            batch.map_depth_m,
            batch.depth_range_m,
            batch.through_red,
        );
        // Ham skor: apply_target_and_policy (forcing max'leri) ve zarf boost'u ÖNCESİ.
        // Paylaşılan gövdedeki through_red rescue kapısı bunu legacy'nin ham classify
        // conf'u ile aynı tabanda görmek için taşır — de-boost yerine (forcing max'leri
        // geri alınamaz; marker denetimi 25 vs 23 rescue sapmasını burada yakaladı).
        let raw_conf = conf;

        apply_target_and_policy(
            &mut class,
            &mut conf,
            &mut reasons,
            b,
            side,
            target,
            corridor,
            batch.through_red,
            batch.map_width_m,
            batch.map_depth_m,
        );

        let zarf = b.wall_s.max(b.line_s * 0.9);
        // Zarf erken: conf kapısından önce oda/tüneli kurtarır (legacy extract_validated
        // aynı boost'u yapar; VPE yaptığı için extract_validated use_vpe'de atlar).
        if zarf >= 0.1 {
            conf = (conf + zarf * 0.32 + 0.05).min(0.98);
        }
        // Legacy extract_validated conf/margin kapılarıyla birebir (pipeline parite testi):
        // tünel sınıfına conf indirimi, through_red'de margin 0.02 ve conf (mc-0.24).max(0.2).
        let aspect = b
            .aspect
            .max((b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3)));
        let margin_need = if batch.through_red {
            0.02
        } else if zarf >= 0.22 {
            0.04
        } else if class == "tunnel" && aspect >= 1.8 {
            0.07
        } else if side {
            0.06
        } else {
            0.12
        };
        let conf_need = if batch.through_red {
            (min_conf - 0.24).max(0.2)
        } else if zarf >= 0.2 {
            (min_conf - 0.18).max(0.26)
        } else if target == "tunnel" || class == "tunnel" {
            (min_conf - 0.12).max(0.25)
        } else if side {
            (min_conf - 0.12).max(0.32)
        } else {
            min_conf
        };

        if class == "noise" || conf < conf_need || margin < margin_need {
            rejected += 1;
            voids.push(VoidDecision {
                id: b.id.clone(),
                class: class.clone(),
                conf,
                raw_conf,
                margin,
                action: "reject".into(),
                rewrite_to: None,
                reasons,
            });
            continue;
        }

        // Legacy `!use_vpe && class == Tunnel` path kapısı (extract_validated): ince
        // koridor değilse odaya çevir; düşük path'li tünelleri (near_red/through_red
        // yoksa) reddet; near_red tünellerini güçlendir. Pipeline parite testi bu kapının
        // VPE'de eksik olduğunu yakaladı (VPE, legacy'nin reddettiği tünelleri kabul ediyordu).
        if class == "tunnel" {
            let measured_h = if side {
                (b.ry * 2.0 * 3.0).max(0.35)
            } else {
                0.0
            };
            let path_need = if batch.through_red {
                0.0
            } else if side {
                if measured_h > 1.35 || aspect < 2.45 {
                    // İnce koridor değil → oda (kırmızı + through_red hariç)
                    if !b.near_red {
                        class = "room".into();
                        conf = conf.max(0.55);
                    } else if !batch.through_red {
                        class = "room".into();
                        conf = conf.max(0.55);
                    }
                    0.0
                } else if b.near_red {
                    0.0
                } else if aspect >= 2.8 {
                    0.42
                } else {
                    0.52
                }
            } else if b.near_red {
                0.0
            } else if aspect >= 2.6 {
                0.38
            } else if aspect >= 2.2 {
                0.48
            } else {
                0.62
            };
            if class == "tunnel"
                && path_need > 0.0
                && (b.path_s < path_need || (!side && aspect < 2.15 && !b.near_red))
            {
                if b.near_red || batch.through_red {
                    // Kırmızı içinde/çıkışında koridor — asla silme
                    conf = conf.max(0.58);
                } else {
                    rejected += 1;
                    voids.push(VoidDecision {
                        id: b.id.clone(),
                        class: class.clone(),
                        conf,
                        raw_conf,
                        margin,
                        action: "reject".into(),
                        rewrite_to: None,
                        reasons: vec!["tunnel_path_low".into()],
                    });
                    continue;
                }
            }
            if class == "tunnel" && b.near_red {
                conf = conf.max(0.6);
            }
        }

        // Chamber cue: legacy build_chamber'ın evidence.wall_support.max(path_support*0.5)
        // karşılığı — tünellerde path dahil (wall_s.max(line_s).max(path_s*0.5)).
        let depth_cue = if class == "tunnel" {
            b.wall_s.max(b.line_s).max(b.path_s * 0.5)
        } else {
            b.wall_s.max(b.line_s)
        };
        let depth = estimate_depth(
            b,
            side,
            batch.depth_range_m,
            depth_cue,
            &class,
            batch.map_width_m,
            batch.map_depth_m,
        );
        depths.push(DepthDecision {
            id: b.id.clone(),
            cover_m: depth.0,
            floor_m: depth.1,
            height_m: (depth.1 - depth.0).max(0.5),
            emergence: depth.2,
        });

        if class == "room" || class == "tomb" {
            room_slots.push(RoomSlot {
                id: b.id.clone(),
                cx: b.cx,
                cy: b.cy,
                rx: b.rx,
                ry: b.ry,
                width_m: (b.rx * 2.0 * batch.map_width_m).clamp(0.4, batch.map_width_m),
                top: depth.0,
                bottom: depth.1,
                height_m: (depth.1 - depth.0).max(0.5),
                intensity: b.intensity,
            });
        }

        *by_class.entry(class.clone()).or_insert(0) += 1;
        accepted += 1;
        voids.push(VoidDecision {
            id: b.id.clone(),
            class,
            conf,
            raw_conf,
            margin,
            action: "accept".into(),
            rewrite_to: None,
            reasons,
        });
    }

    let links = link_rooms(
        &room_slots,
        side,
        batch.depth_range_m,
        min_conf,
        corridor,
        batch.through_red,
        &batch.pair_paths,
    );
    for _ in &links {
        *by_class.entry("tunnel".into()).or_insert(0) += 1;
        accepted += 1;
    }

    let metals = decide_metals(
        &batch.metal_blobs,
        &room_slots,
        &links,
        min_conf,
        corridor,
        side,
        batch.map_width_m,
    );
    for m in &metals {
        if m.action == "attach" {
            accepted += 1;
        } else {
            rejected += 1;
        }
    }

    DecisionBatch {
        schema_version: SCHEMA_VERSION.into(),
        engine_version: ENGINE_VERSION.into(),
        policy_id,
        stub: false,
        message: format!(
            "Faz B decide · kabul {accepted} · red {rejected} · link {}",
            links.len()
        ),
        voids,
        depths,
        links,
        metals,
        report: DecisionReport {
            accepted,
            rejected,
            void_blob_count: batch.void_blobs.len() as u32,
            metal_blob_count: batch.metal_blobs.len() as u32,
            by_class,
        },
    }
}

#[derive(Debug, Clone)]
pub struct RoomSlot {
    pub id: String,
    pub cx: f32,
    pub cy: f32,
    pub rx: f32,
    pub ry: f32,
    pub width_m: f32,
    pub top: f32,
    pub bottom: f32,
    pub height_m: f32,
    pub intensity: f32,
}

fn normalize_target(t: &str) -> &'static str {
    match t.trim().to_ascii_lowercase().as_str() {
        "well" | "kuyu" | "shaft" => "well",
        "room" | "oda" | "tomb" | "mezar" => "room",
        "tunnel" | "tunel" | "tünel" => "tunnel",
        "site" | "yapi" | "yapı" | "structure" => "site",
        _ => "auto",
    }
}

fn apply_target_and_policy(
    class: &mut String,
    conf: &mut f32,
    reasons: &mut Vec<String>,
    b: &crate::schema::BlobDto,
    side: bool,
    target: &str,
    corridor: bool,
    through_red: bool,
    map_w: f32,
    map_d: f32,
) {
    let aspect_x = b.rx / b.ry.max(1e-3);
    let measured_h = (b.ry * 2.0 * 3.0).max(0.35);

    // Hedef Kuyu: legacy extract_validated'ın well zorlaması kapılardan ÖNCE uygulanır
    // (sıra: zorla → class_allowed → conf/margin kapısı). VPE kapıları bu fonksiyondan
    // sonra koştuğu için well_like_plan adayı burada şafta çekilmezse erken reddedilirdi
    // — legacy conf'u zorlamadan önce kapıya bakar, VPE ise ham conf'la kapıya bakardı.
    // Common body zorlamayı idempotent olarak tekrar uygular; karar değişmez.
    if target == "well" {
        if !side {
            // Legacy `well_like_plan` portu (classify.rs) — bbox/PCA yumuşatmasıyla
            let bbox_aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
            let aspect = bbox_aspect.min(b.axis_aspect.max(bbox_aspect * 0.85));
            let diam_m = (b.rx * 2.0 * map_w).min(b.ry * 2.0 * map_d).max(0.3);
            if aspect < 2.6
                && b.fill_ratio >= 0.22
                && diam_m >= 0.35
                && diam_m <= 20.0
                && b.intensity >= 0.22
            {
                reasons.push("rewrite:->shaft(well_plan)".into());
                *class = "shaft".into();
                *conf = conf.max(0.55);
            }
        } else {
            // Legacy side well kuralı: SIDE_CLASS_REF_M = 3.0 ile aynı
            let aspect_y = b.ry / b.rx.max(1e-3);
            let height_m = (b.ry * 2.0 * 3.0).max(0.2);
            if aspect_y >= 1.25 || height_m >= 1.0 {
                reasons.push("rewrite:->shaft(well_side)".into());
                *class = "shaft".into();
                *conf = conf.max(0.55);
            }
        }
    }

    if target == "tunnel" && (*class != "noise" || b.intensity >= 0.28) {
        // Legacy birebir: common body Noise + yeterli yoğunlukta bile tunnel'a zorlar
        // (bkz. extract_validated_inner hedef kapısı). Engine Noise'u tamamen hariç
        // tutarsa, Noise->Tunnel zorlaması geçen zayıf bloblar (ör. gürültülü alanlarda
        // I 0.28..0.45) engine'de reddedilip legacy'de kabul edilir — pipeline parite
        // testi bunu yakaladı (tunnel/top/case=113).
        if *class != "tunnel" {
            reasons.push(format!("rewrite:{class}->tunnel(target)"));
            *class = "tunnel".into();
            *conf = conf.max(0.58);
        }
    }

    if side && *class == "tunnel" && target != "tunnel" {
        let room_cut =
            measured_h >= 1.0 || aspect_x < 2.45 || (b.intensity >= 0.45 && aspect_x < 2.8);
        // through_red denetimi: legacy iki dalı birleşimi `room_cut && (!near_red ||
        // (aspect_x < 2.0 && !through_red))` — kalın + kırmızı + through_red → tünelde
        // bırak (kırmızı engellemesin). Engine'de aspect_x < 2.0'lı tünel yapısal
        // olarak oluşmaz (score_side her tünel dalı için aspect_x ≥ 2.1 ister) — ama
        // koşul metinsel olarak legacy ile birebir olsun; rescue/forcing ile Tunnel'a
        // çevrilen bloblar zaten ortak gövdede legacy mantığıyla kesilir (engine_tunnel).
        if room_cut && (!b.near_red || (aspect_x < 2.0 && !through_red)) {
            reasons.push("rewrite:tunnel->room(side_cut)".into());
            *class = "room".into();
            *conf = conf.max(0.58);
        } else if b.path_s < 0.38 && (!b.near_red || !through_red) && !corridor {
            // Legacy birebir (extract_validated yan kesimi): path dalı near_red'de de
            // çalışır — yalnızca through_red iken kırmızı yanındaki düşük path'i tünelde
            // bırakır (kırmızı dolgu path'i böler, tüneli silme). Engine near_red'de
            // hiç çevirmeyince, through_red=false + near_red + düşük path'li yan tünel
            // legacy'de oda olurken VPE'de tünel kalırdı (parite sapması).
            //
            // DENEY KANITI (kayıt): dal yapay olarak erişilebilir kılınıp (alan damgası
            // + sınıflandırıcı boost'u — bkz. side_path_branch_unreachable_guard yorumu)
            // bu koşul `!b.near_red`'e geri alındığında site_target_pipeline_parity
            // case=88'de KIRILDI (legacy oda üretirken VPE tünel tuttu); doğru koşul
            // geri konunca 16/16 süpürme geçti. Süpürme, dal erişilebilir olsaydı
            // sapmayı GERÇEKTEN yakalıyor.
            reasons.push("rewrite:tunnel->room(path)".into());
            *class = "room".into();
            *conf = conf.max(0.55);
        }
    }

    if side && target == "auto" && *class == "shaft" {
        let span_x = b.rx * 2.0 * map_w;
        let aspect_y = b.ry / b.rx.max(1e-3);
        let narrow = span_x <= 1.15 && aspect_y >= 2.35;
        if !narrow {
            reasons.push("rewrite:shaft->room(side_auto)".into());
            *class = "room".into();
            *conf = conf.max(0.64);
        }
    }

    // NOT: near_red conf boost ve line_s→tünel rewrite BURADA YOK — legacy bunları
    // extract_validated'da conf/margin ve tünel path kapılarından SONRA, iki yola da
    // ortak uygular (pipeline parite testi sıralama farkını yakaladı: VPE erken uygulayınca
    // legacy'nin reddetmediği tünelleri path kapısında reddediyordu).
}

#[cfg(test)]
mod parity_tests {
    use super::decide;
    use crate::schema::{BlobDto, EvidenceBatch, PairPath, SCHEMA_VERSION};

    fn room(id: &str, cx: f32, cy: f32) -> BlobDto {
        BlobDto {
            id: id.into(),
            cx,
            cy,
            rx: 0.08,
            ry: 0.07,
            intensity: 0.7,
            fill_ratio: 0.55,
            aspect: 1.15,
            path_s: 0.45,
            wall_s: 0.2,
            line_s: 0.0,
            near_red: false,
            snr: 8.0,
            axis_aspect: 1.15,
            half_len: 0.05,
        }
    }

    #[test]
    fn side_wide_void_is_room_standard() {
        let batch = EvidenceBatch {
            schema_version: SCHEMA_VERSION.into(),
            view_mode: "side".into(),
            target: "auto".into(),
            policy_id: Some("standard".into()),
            depth_range_m: 10.0,
            map_width_m: 24.0,
            map_depth_m: 10.0,
            min_confidence: 0.35,
            through_red: false,
            deep: false,
            calib: None,
            // Legacy classify::side_wide_void_prefers_room_not_shaft ile aynı geometri
            void_blobs: vec![BlobDto {
                id: "v0".into(),
                cx: 0.4,
                cy: 0.35,
                rx: 1.6 / (2.0 * 24.0),
                ry: 0.22,
                intensity: 0.7,
                fill_ratio: 0.55,
                aspect: 1.2,
                path_s: 0.3,
                wall_s: 0.2,
                line_s: 0.0,
                near_red: false,
                snr: 9.0,
                axis_aspect: 1.2,
                half_len: 0.05,
            }],
            metal_blobs: vec![],
            pair_paths: vec![],
        };
        let d = decide(&batch, "standard");
        assert!(!d.stub);
        let v = d.voids.iter().find(|v| v.id == "v0").expect("v0");
        assert_eq!(v.action, "accept");
        assert_eq!(v.class, "room");
        assert!(v.conf >= 0.45);
        assert!(!v.reasons.is_empty(), "reasons for explainability");
    }

    #[test]
    fn adjacent_rooms_get_link_corridor() {
        let batch = EvidenceBatch {
            schema_version: SCHEMA_VERSION.into(),
            view_mode: "side".into(),
            target: "auto".into(),
            policy_id: Some("corridor".into()),
            depth_range_m: 10.0,
            map_width_m: 24.0,
            map_depth_m: 10.0,
            min_confidence: 0.35,
            through_red: false,
            deep: false,
            calib: None,
            void_blobs: vec![room("v0", 0.3, 0.42), room("v1", 0.55, 0.43)],
            metal_blobs: vec![],
            pair_paths: vec![PairPath {
                a_id: "v0".into(),
                b_id: "v1".into(),
                path_s: 0.15,
            }],
        };
        let d = decide(&batch, "corridor");
        assert!(!d.stub);
        assert!(
            !d.links.is_empty(),
            "corridor profile should link adjacent rooms, got {:?}",
            d.links
        );
        assert!(d.links[0].conf >= 0.35);
    }

    #[test]
    fn side_tunnel_requires_min_aspect_x() {
        // through_red denetiminin vakum guard'ı (room_cut hizası): engine side cut'ın
        // `aspect_x < 2.0 && !through_red` dalı ancak Tunnel sınıfında çalışır; score_side
        // her tünel dalı için aspect_x ≥ 2.1 ister (2.55 / 2.4 / through_red 2.1) — bu
        // yüzden engine'de aspect_x < 2.0'lı tünel YAPISAL OLARAK yok ve room_cut koşulu
        // ile legacy'nin iki dalı birleşimi erişilebilirlikte aynı. score_side değişir de
        // düşük aspect'te tünel üretirse bu test kırılır → room_cut hizasını yeniden
        // doğrulamayı hatırlatır.
        let mut n_accepted_room = 0usize;
        for through_red in [false, true] {
            for aspect_x in [1.5f32, 1.8, 1.95, 1.99] {
                for intensity in [0.3f32, 0.4] {
                    let mut b = room("v0", 0.5, 0.65);
                    b.rx = 0.1;
                    b.ry = 0.1 / aspect_x; // rx/ry = aspect_x
                    b.aspect = aspect_x.max(1.0 / aspect_x);
                    b.axis_aspect = b.aspect;
                    // I=0.3: room'un 0.48+dalları düşer (I < 0.35 → 0.14 tabanı) — eğer
                    // bir gün score_side 2.1 altında tünel üretirse (3. dal + çarpan
                    // eşikleri) bu geometride tünel KAZANIR ve guard kırılır. I=0.4 ise
                    // conf kapısını geçen kabul edilmiş room'ları üretir (vakum).
                    b.intensity = intensity;
                    b.fill_ratio = 0.55;
                    b.path_s = 0.6;
                    b.near_red = true;
                    let batch = EvidenceBatch {
                        schema_version: SCHEMA_VERSION.into(),
                        view_mode: "side".into(),
                        target: "auto".into(),
                        policy_id: Some("standard".into()),
                        depth_range_m: 10.0,
                        map_width_m: 24.0,
                        map_depth_m: 10.0,
                        min_confidence: 0.35,
                        through_red,
                        deep: false,
                        calib: None,
                        void_blobs: vec![b],
                        metal_blobs: vec![],
                        pair_paths: vec![],
                    };
                    let d = decide(&batch, "standard");
                    let v = d.voids.iter().find(|v| v.id == "v0").unwrap();
                    assert_ne!(
                        v.class, "tunnel",
                        "aspect_x={aspect_x} I={intensity} through_red={through_red}: \
                         tünel yapısal olarak imkânsız (score_side eşikleri değişti mi?)"
                    );
                    if v.action == "accept" && v.class == "room" {
                        n_accepted_room += 1;
                    }
                }
            }
        }
        assert!(n_accepted_room > 0, "vakum: en az bir kabul edilmiş room olmalı");
    }

    #[test]
    fn top_through_red_relaxes_link_path_need() {
        // Link zinciri denetiminin regresyonu: legacy link_chambers_with_path eşiği
        // `if side || through_red { 0.12 } else { 0.58 }` — kırmızı dolgu path'i kesmez,
        // dik + through_red'de de gevşetilir. Port `side` dışındaki dalı kaçırıyordu:
        // dik + through_red'de 0.58 istiyordu → 0.12..0.58 arası path'li odalar hiç
        // bağlanmıyordu (standard modda engine linkleri atıldığı için gizliydi; corridor
        // modunda tüketilince yanlış çıktı verirdi).
        // Geometri: score_top'ta room için aspect ∈ [1.5, 1.85), area_n ∈ [0.004, 0.01]
        // (tomb dalını atlatmak için ≤ 0.01), fill < 0.38 (compact→şaft dalını kırmak için)
        // — bakınız score_top/score.rs.
        let wide_room = |id: &str, cx: f32| BlobDto {
            id: id.into(),
            cx,
            cy: 0.4,
            rx: 0.06,
            ry: 0.04,
            intensity: 0.7,
            fill_ratio: 0.3,
            aspect: 1.5,
            path_s: 0.45,
            wall_s: 0.2,
            line_s: 0.0,
            near_red: false,
            snr: 8.0,
            axis_aspect: 1.5,
            half_len: 0.05,
        };
        let base = EvidenceBatch {
            schema_version: SCHEMA_VERSION.into(),
            view_mode: "top".into(),
            target: "auto".into(),
            policy_id: Some("standard".into()),
            depth_range_m: 10.0,
            map_width_m: 24.0,
            map_depth_m: 10.0,
            min_confidence: 0.35,
            through_red: true,
            deep: false,
            calib: None,
            void_blobs: vec![wide_room("v0", 0.3), wide_room("v1", 0.55)],
            metal_blobs: vec![],
            pair_paths: vec![PairPath {
                a_id: "v0".into(),
                b_id: "v1".into(),
                path_s: 0.3,
            }],
        };
        // through_red=true → eşik 0.12: path 0.3 yeterli → bağlanmalı
        let d = decide(&base, "standard");
        assert!(!d.stub);
        assert!(
            !d.links.is_empty(),
            "dik + through_red: path 0.3 ≥ 0.12 eşiğiyle bağlanmalı (legacy paritesi), got {:?}",
            d.links
        );
        // through_red=false → eşik 0.58: path 0.3 yetersiz → bağlanmamalı
        let mut no_red = base;
        no_red.through_red = false;
        let d2 = decide(&no_red, "standard");
        assert!(
            d2.links.is_empty(),
            "dik + !through_red: path 0.3 < 0.58 → bağlanmamalı, got {:?}",
            d2.links
        );
    }

    #[test]
    fn near_red_tunnel_gets_path_gate_boost() {
        // near_red tünel: tünel path kapısı conf'u 0.6'a çeker — legacy extract_validated
        // ile birebir (near_red conf boost'u artık VPE'de değil, kapı sonrası ortak kodda).
        let mut b = room("v0", 0.4, 0.4);
        b.rx = 0.024;
        b.ry = 0.01;
        b.aspect = (b.rx / b.ry).max(b.ry / b.rx); // 2.4
        b.path_s = 0.4;
        b.near_red = true;
        let batch = EvidenceBatch {
            schema_version: SCHEMA_VERSION.into(),
            view_mode: "top".into(),
            target: "auto".into(),
            policy_id: Some("standard".into()),
            depth_range_m: 10.0,
            map_width_m: 24.0,
            map_depth_m: 10.0,
            min_confidence: 0.35,
            through_red: false,
            deep: false,
            calib: None,
            void_blobs: vec![b],
            metal_blobs: vec![],
            pair_paths: vec![],
        };
        let d = decide(&batch, "standard");
        let v = d.voids.iter().find(|v| v.id == "v0").unwrap();
        assert_eq!(v.action, "accept");
        assert_eq!(v.class, "tunnel");
        assert!(
            v.conf >= 0.6,
            "near_red tünel path kapısında 0.6'a çekilmeli, got {}",
            v.conf
        );
    }

    #[test]
    fn near_red_low_path_side_tunnel_cut_to_room() {
        // Legacy yan kesiminin path dalı (extract_validated): near_red + through_red=false
        // + path_s < 0.38 olan yan tüneli odaya çevirir (kırmızı yalnızca through_red'de
        // tüneli korur). Engine near_red'i hiç çevirmeyince parite sapardı — bu dal artık
        // legacy ile birebir: (!near_red || !through_red).
        //
        // Neden pipeline süpürmesi bunu kapsayamaz (ölçüm: 1200 yan alanda 84 geniş blob,
        // min path_s 0.8): path_s < 0.38 için eksen üzerinde ≥3 piksel boşluk gerekir
        // (path_samples ±1 px dikey örnek alır); bu, şeridin ≥5 px (measured_h ≥ 0.45 m)
        // olmasını zorlar; measured_h ≥ 0.45 iken score_side room skoru (0.58 + fill·0.24
        // + I·0.22 + ≥0.7m bonusları) tüneli her zaman yener → blob Room sınıflanır ve
        // kesim (yalnızca Tunnel) ateşlenmez. Katı blobların path_s'i de 1.0'dır (eksen
        // blobun içinde kalır). Bu yüzden dal ölü koddur ve motor seviyesindeki bu test
        // onun tek korumasıdır.
        // Geometri: score_side'da tünelin odayı kıl payı geçtiği ince galeri (aspect 2.67,
        // measured_h 0.35, span 5.76 m, path 0.3). cy=0.65 — cy<=0.55 oda bonusu tüneli ezerdi.
        let mut b = room("v0", 0.5, 0.65);
        b.rx = 0.12;
        b.ry = 0.045;
        b.aspect = 2.67;
        b.axis_aspect = 2.67;
        b.half_len = 0.1;
        // I < 0.35 → score_side'da room 0.14 tabanına düşer, tünel rahat kazanır
        // (margin ≈ 0.41 ≥ 0.06) — path dalı canlı ve yapı her iki tarafta da hayatta kalır.
        b.intensity = 0.3;
        b.path_s = 0.3;
        b.near_red = true;
        let batch = EvidenceBatch {
            schema_version: SCHEMA_VERSION.into(),
            view_mode: "side".into(),
            target: "auto".into(),
            policy_id: Some("standard".into()),
            depth_range_m: 10.0,
            map_width_m: 24.0,
            map_depth_m: 10.0,
            min_confidence: 0.35,
            through_red: false,
            deep: false,
            calib: None,
            void_blobs: vec![b],
            metal_blobs: vec![],
            pair_paths: vec![],
        };
        let d = decide(&batch, "standard");
        let v = d.voids.iter().find(|v| v.id == "v0").unwrap();
        assert_eq!(v.action, "accept");
        assert_eq!(
            v.class, "room",
            "near_red + !through_red + düşük path'li yan tünel legacy gibi odaya çevrilmeli"
        );
    }
}

/**
 * metalAlarm.js — Değerli metal alarm sistemi.
 *
 * Özellikler:
 *   1. Sesli uyarı: Web Audio API ile metal tespit edildiğinde beep sesi
 *   2. Dönen kırmızı ışık topu: Her metal yapının üstünde pulsing glow efekti
 *   3. Kullanıcı kontrolü: Açık/kapalı, ses seviyesi, tekrar hızı
 *
 * Kullanım:
 *   import { metalAlarm, setAlarmEnabled, setAlarmVolume } from "./metalAlarm.js";
 *   metalAlarm.activate(metalStructures, mapW, mapD, vertExag);
 *   metalAlarm.deactivate();
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { onPreRender, offPreRender } from "./scene.js";
import { mapToWorld } from "./coords.js";

/* ── Alarm Durumu ──────────────────────────────────────── */
const alarmState = {
  enabled: true,        // Alarm aktif mi?
  soundEnabled: true,   // Ses açık mı?
  soundStyle: "classic", // Ses stili: melody | siren | classic | vibrato
  volume: 0.6,          // Ses seviyesi (0-1)
  beepInterval: 2000,   // Beep aralığı (ms)
  flashSpeed: 2.0,      // Işık döndürme hızı
  lastBeepTime: 0,
  spheres: [],          // Aktif kırmızı ışık sphere'ları
  audioCtx: null,       // Web Audio context
  preRenderFn: null,    // Pre-render hook
};

/* ── Web Audio Beep ────────────────────────────────────── */
function getAudioContext() {
  if (!alarmState.audioCtx) {
    try {
      alarmState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("[MetalAlarm] Web Audio desteklenmiyor:", e);
    }
  }
  return alarmState.audioCtx;
}

/**
 * Tek tonlu beep — vibrato ve harmonik destekli.
 * @param {number} freq  - Ana frekans (Hz)
 * @param {number} dur   - Süre (s)
 * @param {object} opts  - Ek seçenekler
 */
function playTone(freq = 880, dur = 0.15, opts = {}) {
  if (!alarmState.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const vol = alarmState.volume * (opts.volScale || 1);
  const type = opts.wave || "triangle";

  // ── Ana osc (triangle — zengin tını) ──
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = type;
  osc1.frequency.setValueAtTime(freq, now);
  // Vibrato: ±8Hz normal, ±25Hz heavy
  osc1.frequency.setValueAtTime(freq, now);
  const vibrato = ctx.createOscillator();
  const vibratoGain = ctx.createGain();
  if (opts.heavyVibrato) {
    vibrato.frequency.value = 12;  // Hızlı titreşim
    vibratoGain.gain.value = 25;   // Geniş salınım
  } else {
    vibrato.frequency.value = 6;
    vibratoGain.gain.value = 8;
  }
  vibrato.connect(vibratoGain);
  vibratoGain.connect(osc1.frequency);
  vibrato.start(now);
  vibrato.stop(now + dur + 0.05);
  // Envelope
  gain1.gain.setValueAtTime(0.001, now);
  gain1.gain.linearRampToValueAtTime(vol * 0.35, now + 0.008);
  gain1.gain.setValueAtTime(vol * 0.35, now + dur * 0.7);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + dur + 0.05);

  // ── Harmonik (2. harmonik — oktav üst, hafif) ──
  if (opts.harmonic !== false) {
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(freq * 2, now);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.linearRampToValueAtTime(vol * 0.08, now + 0.01);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now + dur + 0.05);
  }

  // ── Sub-bass (1/3 oktav alt, derinlik) ──
  if (opts.subBass) {
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(freq / 3, now);
    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(vol * 0.15, now + 0.015);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.8);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + dur + 0.05);
  }
}

/**
 * Değerli metal bulundu melodi — 3 notalık ascending alarm.
 * C5 → E5 → A5 arası hızlı geçiş, dikkat çekici.
 */
/** Her ses stili için melodi/desen tanımları */
const SOUND_PROFILES = {
  // 🎵 Ascending major akor: A5 → C#6 → E6
  melody: {
    found: [
      { freq: 880,       dur: 0.10, t: 0,    wave: "triangle", harmonic: true  },
      { freq: 1100,      dur: 0.10, t: 0.09, wave: "triangle", harmonic: true  },
      { freq: 1320,      dur: 0.22, t: 0.18, wave: "triangle", harmonic: true  },
    ],
    repeat: [
      { freq: 1047, dur: 0.08, t: 0,    wave: "sine", harmonic: false, volScale: 0.7 },
      { freq: 880,  dur: 0.12, t: 0.08, wave: "sine", harmonic: false, volScale: 0.5 },
    ],
  },
  // 🚨 Alçalan siren: E6 → C6 → A5 (3 notalık)
  siren: {
    found: [
      { freq: 1320, dur: 0.12, t: 0,    wave: "sawtooth", harmonic: true,  subBass: true  },
      { freq: 1047, dur: 0.12, t: 0.11, wave: "sawtooth", harmonic: true,  subBass: false },
      { freq: 880,  dur: 0.25, t: 0.22, wave: "sawtooth", harmonic: false, subBass: true  },
    ],
    repeat: [
      { freq: 1047, dur: 0.06, t: 0,    wave: "square", harmonic: false, volScale: 0.5 },
      { freq: 880,  dur: 0.10, t: 0.05, wave: "square", harmonic: false, volScale: 0.35 },
    ],
  },
  // 🔔 Klasik çift beep — clean & professional
  classic: {
    found: [
      { freq: 880,  dur: 0.12, t: 0,    wave: "sine", harmonic: true,  subBass: true  },
      { freq: 1100, dur: 0.18, t: 0.15, wave: "sine", harmonic: true,  subBass: false },
    ],
    repeat: [
      { freq: 660, dur: 0.08, t: 0, wave: "sine", harmonic: false, volScale: 0.6 },
    ],
  },
  // 〰️ Vibrato heavy — titreşim efektli alarm
  vibrato: {
    found: [
      { freq: 880,  dur: 0.30, t: 0,    wave: "triangle", harmonic: true,  subBass: true, heavyVibrato: true },
      { freq: 1100, dur: 0.35, t: 0.25, wave: "triangle", harmonic: true,  subBass: true, heavyVibrato: true },
    ],
    repeat: [
      { freq: 880, dur: 0.15, t: 0, wave: "triangle", harmonic: false, volScale: 0.5, heavyVibrato: true },
    ],
  },
};

/** Belirli bir profile göre notaları çal */
function playProfile(profile) {
  const p = SOUND_PROFILES[profile] || SOUND_PROFILES.classic;
  for (const n of p.found) {
    setTimeout(() => playTone(n.freq, n.dur, {
      wave: n.wave || "triangle",
      harmonic: n.harmonic,
      subBass: n.subBass,
      volScale: n.volScale || 1,
      heavyVibrato: n.heavyVibrato,
    }), n.t * 1000);
  }
}

function playRepeatProfile(profile) {
  const p = SOUND_PROFILES[profile] || SOUND_PROFILES.classic;
  for (const n of p.repeat) {
    setTimeout(() => playTone(n.freq, n.dur, {
      wave: n.wave || "sine",
      harmonic: n.harmonic,
      subBass: n.subBass,
      volScale: n.volScale || 1,
      heavyVibrato: n.heavyVibrato,
    }), n.t * 1000);
  }
}

/** Değerli metal bulundu — aktif profile göre melodiyi çal */
function playMetalFoundBeep() {
  playProfile(alarmState.soundStyle);
}

/** Tekrar beep — aktif profile göre */
function playRepeatBeep() {
  playRepeatProfile(alarmState.soundStyle);
}

/* ── 3D Işık Topu ──────────────────────────────────────── */

/**
 * Metal yapının üstünde dönen kırmızı ışık topu oluştur.
 * @returns {THREE.Group} Işık topu + halo
 */
function createAlarmSphere() {
  const group = new THREE.Group();
  group.userData.isAlarmLight = true;

  // Ana küre — parlak kırmızı
  const coreGeo = new THREE.SphereGeometry(0.35, 24, 24);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff1a1a,
    emissive: 0xff0000,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.95,
    roughness: 0.1,
    metalness: 0.3,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.name = "alarmCore";
  group.add(core);

  // Dış halo — yarı saydam kırmızı halka
  const haloGeo = new THREE.SphereGeometry(0.6, 16, 16);
  const haloMat = new THREE.MeshStandardMaterial({
    color: 0xff3300,
    emissive: 0xff2200,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0.35,
    roughness: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.name = "alarmHalo";
  group.add(halo);

  // Zemin gölge halkası — yerde kırmızı ışık dairesi
  const shadowGeo = new THREE.RingGeometry(0.4, 1.2, 32);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0xff2200,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.name = "alarmShadow";
  shadow.rotation.x = -Math.PI / 2; // Yatay düzleme çevir
  shadow.position.y = -1.2;          // Zemin seviyesine in
  group.add(shadow);

  // Işık virajı — nokta ışığı
  const light = new THREE.PointLight(0xff2200, 3.0, 5.0, 2);
  light.name = "alarmLight";
  group.add(light);

  // Raycaster ile tıklanamasın
  group.userData.isAlarmLight = true;
  core.userData.isAlarmLight = true;
  halo.userData.isAlarmLight = true;
  shadow.userData.isAlarmLight = true;

  return group;
}

/* ── Pre-Render Animasyon ──────────────────────────────── */
function tickAlarms() {
  if (!alarmState.enabled || alarmState.spheres.length === 0) return;

  const t = performance.now() * 0.001; // saniye
  const speed = alarmState.flashSpeed;

  for (const entry of alarmState.spheres) {
    const { group, baseY, baseScale } = entry;
    if (!group || !group.parent) continue;
    const bs = baseScale || 1.0;

    // Döndürme
    group.rotation.y = t * speed;

    // Pulsing — çekirdek boyutu (baseScale ile orantılı)
    const core = group.getObjectByName("alarmCore");
    if (core) {
      const pulse = bs * (1.0 + 0.25 * Math.sin(t * speed * 2));
      core.scale.setScalar(pulse);
      core.material.emissiveIntensity = 1.5 + 0.8 * Math.sin(t * speed * 3);
      core.material.opacity = 0.8 + 0.2 * Math.sin(t * speed * 4);
    }

    // Halo genişleme/süzülme (baseScale ile orantılı)
    const halo = group.getObjectByName("alarmHalo");
    if (halo) {
      const haloPulse = bs * (1.0 + 0.35 * Math.sin(t * speed * 1.5 + 1));
      halo.scale.setScalar(haloPulse);
      halo.material.opacity = 0.2 + 0.15 * Math.sin(t * speed * 2);
      halo.rotation.x = t * speed * 0.3;
    }

    // Işık parlaklığı — vertExag ile orantılı
    const light = group.getObjectByName("alarmLight");
    if (light) {
      light.intensity = (2.0 + 1.5 * Math.sin(t * speed * 3)) * bs;
    }

    // Zemin gölge halkası pulsing (baseScale ile orantılı)
    const shadow = group.getObjectByName("alarmShadow");
    if (shadow) {
      const shadowPulse = bs * (1.0 + 0.3 * Math.sin(t * speed * 2 + 0.5));
      shadow.scale.setScalar(shadowPulse);
      shadow.material.opacity = 0.2 + 0.2 * Math.sin(t * speed * 2.5);
    }

    // Hafif dikey salınım
    group.position.y = baseY + 0.15 * Math.sin(t * 1.5);
  }

  // Ses tekrarı
  const now = performance.now();
  if (now - alarmState.lastBeepTime > alarmState.beepInterval) {
    alarmState.lastBeepTime = now;
    playRepeatBeep();
  }
}

/* ── Public API ────────────────────────────────────────── */

export const metalAlarm = {
  /**
   * Metal yapılar için alarm sphere'larını sahneye yerleştir.
   * @param {Array} metals - detectStructuresFromTerrain().metals
   * @param {number} mapW  - Harita genişliği (metre)
   * @param {number} mapD  - Harita derinliği (metre)
   * @param {number} vertExag - Dikey abartı
   * @param {boolean} sideView - Yan görünüm
   */
  activate(metals, mapW, mapD, vertExag, sideView = false) {
    this.deactivate(); // Önceki alarm'ları temizle

    if (!alarmState.enabled || !metals || metals.length === 0) return;

    const group = state.structureGroup;
    if (!group) return;

    metals.forEach((m, i) => {
      const { x, z } = mapToWorld(
        Math.max(0, Math.min(1, m.cx)),
        Math.max(0, Math.min(1, m.cy)),
        mapW, mapD, sideView
      );

      const sphere = createAlarmSphere();
      // Alarm topu zeminin hemen üstünde — resimdeki metal tespitinin tam üzeri
      const y = 1.2;
      sphere.position.set(x, y, z);
      // vertExag ile orantılı ölçek — sahneyle uyumlu boyut
      const s = Math.max(0.5, Math.min(2.0, 0.6 + vertExag * 0.4));
      sphere.scale.setScalar(s);
      sphere.userData.metalIndex = i;
      sphere.userData.metalId = `metal-${i}`;

      group.add(sphere);
      alarmState.spheres.push({ group: sphere, baseY: y, baseScale: s });
    });

    // Pre-render hook ekle
    if (!alarmState.preRenderFn) {
      alarmState.preRenderFn = tickAlarms;
      onPreRender(alarmState.preRenderFn);
    }

    // İlk beep
    playMetalFoundBeep();

    invalidate();
    console.log(`[MetalAlarm] ${metals.length} metal için alarm aktif edildi`);
  },

  /** Tüm alarm'ları kaldır */
  deactivate() {
    for (const entry of alarmState.spheres) {
      if (entry.group && entry.group.parent) {
        entry.group.parent.remove(entry.group);
      }
      // Geometry ve material dispose
      entry.group?.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }
    alarmState.spheres = [];

    if (alarmState.preRenderFn) {
      offPreRender(alarmState.preRenderFn);
      alarmState.preRenderFn = null;
    }

    invalidate();
  },

  /** Sadece iç durumu temizle — dispose yapma (structureGroup.clearStructures halleder) */
  clearAll() {
    alarmState.spheres = [];
    if (alarmState.preRenderFn) {
      offPreRender(alarmState.preRenderFn);
      alarmState.preRenderFn = null;
    }
  },

  /** Alarm durumunu toggle et */
  toggle() {
    alarmState.enabled = !alarmState.enabled;
    if (!alarmState.enabled) {
      this.deactivate();
    }
    return alarmState.enabled;
  },

  /** Ses durumunu toggle et */
  toggleSound() {
    alarmState.soundEnabled = !alarmState.soundEnabled;
    return alarmState.soundEnabled;
  },

  /** Ses seviyesini ayarla (0-1) */
  setVolume(v) {
    alarmState.volume = Math.max(0, Math.min(1, Number(v) || 0));
  },

  /** Beep aralığını ayarla (ms) */
  setInterval(ms) {
    alarmState.beepInterval = Math.max(500, Math.min(5000, Number(ms) || 2000));
  },

  /** Işık döndürme hızını ayarla */
  setFlashSpeed(s) {
    alarmState.flashSpeed = Math.max(0.5, Math.min(5, Number(s) || 2));
  },

  /** Ses stilini ayarla: melody | siren | classic | vibrato */
  setSoundStyle(style) {
    const valid = ["melody", "siren", "classic", "vibrato"];
    alarmState.soundStyle = valid.includes(style) ? style : "classic";
  },

  /** Test beep çal */
  testBeep() {
    playMetalFoundBeep();
  },

  /** Mevcut durum */
  getState() {
    return {
      enabled: alarmState.enabled,
      soundEnabled: alarmState.soundEnabled,
      soundStyle: alarmState.soundStyle,
      volume: alarmState.volume,
      beepInterval: alarmState.beepInterval,
      flashSpeed: alarmState.flashSpeed,
      activeSpheres: alarmState.spheres.length,
    };
  },
};

import * as THREE from "three";
import { state } from "../app/state.js";
import { mapToWorld } from "./coords.js";
import { invalidate } from "./scene.js";

/** Soft relief amplitude (m) — view-mode default (yapı kot farkı ayrı). */
export function reliefAmpM(viewMode) {
  return viewMode === "side" ? 0.15 : 1.0;
}

function distToSeg2d(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/**
 * Yapı başına kot yamaları: yapı sabit; yerel yüzey +Y (veya −kot ile −Y).
 * @returns {{kind:"disk"|"seg", lift:number, x?:number, z?:number, rx?:number, rz?:number, ax?:number, az?:number, bx?:number, bz?:number, halfW?:number}[]}
 */
export function collectKotPatches(surface, mapW, mapD, vertExag = 1) {
  const patches = [];
  const kotMap = state.structureKotM || {};
  const structs = surface?.structures || {};
  const sideView = (surface?.viewMode || surface?.view_mode || "top") === "side";
  const ex = Number.isFinite(vertExag) && vertExag > 0 ? vertExag : 1;

  (structs.chambers || []).forEach((c, i) => {
    if (c.kind === "cavity") return;
    const kot = Number(kotMap[`chamber-${i}`] ?? 0);
    if (!Number.isFinite(kot) || Math.abs(kot) < 1e-6) return;
    const { x, z } = mapToWorld(c.cx, c.cy, mapW, mapD, sideView);
    const wM = Number(c.widthM ?? c.width_m ?? 2);
    const lM = Number(c.lengthM ?? c.length_m ?? wM);
    const rx = Math.max(wM * 0.65, 1.2);
    const rz = Math.max((sideView ? Math.min(lM, 2.2) : lM) * 0.65, 1.2);
    patches.push({ kind: "disk", x, z, rx, rz, lift: kot * ex });
  });

  (structs.tunnels || []).forEach((t, i) => {
    const kot = Number(kotMap[`tunnel-${i}`] ?? 0);
    if (!Number.isFinite(kot) || Math.abs(kot) < 1e-6) return;
    const a = mapToWorld(t.x0, t.y0, mapW, mapD, sideView);
    const b = mapToWorld(t.x1, t.y1, mapW, mapD, sideView);
    const halfW = Math.max(Number(t.widthM ?? t.width_m ?? 1.2) * 0.75, 1.0);
    patches.push({
      kind: "seg",
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      halfW,
      lift: kot * ex,
    });
  });

  (structs.metals || []).forEach((m, i) => {
    const kot = Number(kotMap[`metal-${i}`] ?? 0);
    if (!Number.isFinite(kot) || Math.abs(kot) < 1e-6) return;
    const { x, z } = mapToWorld(m.cx, m.cy, mapW, mapD, sideView);
    const spread = Number(m.spreadM ?? m.spread_m ?? 0);
    const wM = Number(m.widthM ?? m.width_m ?? 1.2);
    const lM = Number(m.lengthM ?? m.length_m ?? wM);
    const r = Math.max(spread, wM, lM, 1.2) * 0.7;
    patches.push({ kind: "disk", x, z, rx: r, rz: r, lift: kot * ex });
  });

  return patches;
}

function kotLiftAt(px, pz, patches) {
  if (!patches?.length) return 0;
  let lift = 0;
  for (const p of patches) {
    let w = 0;
    if (p.kind === "seg") {
      const d = distToSeg2d(px, pz, p.ax, p.az, p.bx, p.bz);
      const hw = Math.max(p.halfW || 1, 0.4);
      if (d >= hw) continue;
      const u = 1 - d / hw;
      w = u * u;
    } else {
      const nx = (px - p.x) / Math.max(p.rx, 0.2);
      const nz = (pz - p.z) / Math.max(p.rz, 0.2);
      const d2 = nx * nx + nz * nz;
      if (d2 >= 1) continue;
      w = (1 - d2) * (1 - d2);
    }
    const v = p.lift * w;
    if (v >= 0) lift = Math.max(lift, v);
    else lift = Math.min(lift, v);
  }
  return lift;
}

function rgbToRgba(colors, needRgb) {
  const n = Math.floor(needRgb / 3);
  const out = new Uint8Array(n * 4);
  const src = colors && colors.length >= needRgb ? colors : null;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    if (src) {
      out[i * 4] = src[j] ?? 40;
      out[i * 4 + 1] = src[j + 1] ?? 80;
      out[i * 4 + 2] = src[j + 2] ?? 50;
    } else {
      out[i * 4] = 40;
      out[i * 4 + 1] = 90;
      out[i * 4 + 2] = 55;
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** GPU destekli anizotropik filtreleme (8'e kadar) — uzak planda titremeyi keser. */
function groundAniso() {
  const cap = state.renderer?.capabilities;
  return cap ? Math.min(8, cap.getMaxAnisotropy()) : 4;
}

export function makeMapDataTexture(colors, gw, gh) {
  const needRgb = gw * gh * 3;
  const data = rgbToRgba(colors, needRgb);
  const tex = new THREE.DataTexture(data, gw, gh, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  // WebGL2 NPOT dokularda da mipmap üretir → uzak plan sakin, shimmering yok
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = groundAniso();
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

export function makePreviewTexture(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const image = new Image();
  image.src = dataUrl;
  const tex = new THREE.Texture(image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = groundAniso();
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = true;
  const mark = () => {
    tex.needsUpdate = true;
    invalidate();
  };
  if (image.complete && image.naturalWidth > 0) mark();
  else image.onload = mark;
  return tex;
}

function heightAt(heights, gw, gh, gx, gyImg) {
  const i = gyImg * gw + gx;
  if (!heights || i < 0 || i >= heights.length) return 0;
  const h = Number(heights[i]);
  if (!Number.isFinite(h)) return 0;
  return Math.tanh(h);
}

/** Signed alan → yer altı Y. Mavi (−) daha derin; kırmızı (+) sığ ama yine aşağı — yukarı çıkmaz. */
function burialReliefY(signed01) {
  if (signed01 <= 0) return signed01; // void: −Y → tam derinlik
  return -signed01 * 0.7; // metal/kırmızı: yine aşağı, biraz daha derin
}

function resolveColors(surface) {
  const c = surface.colors;
  if (!c) return [];
  if (Array.isArray(c)) return c;
  if (c instanceof Uint8Array) return c;
  if (typeof c === "object" && c.length != null) return Array.from(c);
  return [];
}

/** Kontur aralığı için “şık” adım seç (0.25 / 0.5 / 1 / 2 / 5 m …). */
function niceStep(x) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10];
  for (const s of steps) if (x <= s) return s;
  return 10;
}

function makeMaterial(tex, wireframe, contour = null) {
  const mat = new THREE.MeshStandardMaterial({
    map: wireframe ? null : tex,
    emissiveMap: wireframe ? null : tex,
    emissive: wireframe ? 0x000000 : 0xffffff,
    emissiveIntensity: wireframe ? 0 : 0.55,
    color: wireframe ? 0x3d6b45 : 0xffffff,
    transparent: true,
    opacity: wireframe ? 0.18 : 0.82,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
    wireframe: !!wireframe,
    depthWrite: !wireframe,
  });

  // Derinlik kontur çizgileri — mevcut PBR zincirine hafif enjeksiyon.
  // fwidth tabanlı AA: her zoom seviyesinde piksel kalınlığında net çizgi.
  if (!wireframe && contour && contour.interval > 0) {
    const interval = contour.interval;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uContourInterval = { value: interval };
      shader.uniforms.uContourColor = { value: new THREE.Color(0x03140d) };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vGroundDepth;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvGroundDepth = -(modelMatrix * vec4(transformed, 1.0)).y;"
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vGroundDepth;\nuniform float uContourInterval;\nuniform vec3 uContourColor;"
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
{
  float g = vGroundDepth / uContourInterval;
  float fw = max(fwidth(g), 1e-4);
  float lineD = abs(fract(g + 0.5) - 0.5);
  float line = 1.0 - min(lineD / (fw * 1.3), 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uContourColor, line * 0.5);
  totalEmissiveRadiance = mix(totalEmissiveRadiance, uContourColor, line * 0.65);
}`
        );
    };
    // Farklı aralıklar farklı program derlesin (program önbelleği çakışmasın)
    mat.customProgramCacheKey = () => `ground-contour-${interval}`;
  }
  return mat;
}

/**
 * Colormap haritayı XZ zemine serer (dik ve yan aynı çerçeve).
 * Gömü yapılar −Y'de; yan çekimde dikey “perde” yok.
 * Yapı kot farkı: yapı sabit, yerel yüzey yukarı (veya −kot ile aşağı).
 */
export function buildGroundSurface(surface, wireframe = false, vertExag = 1, depressionScale = 1) {
  const gw = Math.max(2, surface.gridW ?? surface.grid_w ?? 2);
  const gh = Math.max(2, surface.gridH ?? surface.grid_h ?? 2);
  const mapW = Number(
    surface.mapWidthM ?? surface.map_width_m ?? surface.mapSizeM ?? surface.map_size_m ?? 24
  );
  const mapD = Number(
    surface.mapDepthM ?? surface.map_depth_m ?? mapW * (gh / Math.max(gw, 1))
  );
  const viewMode = surface.viewMode || surface.view_mode || "top";
  // Veri aralığına göre bağımsız de Amp — haritanın derinliğine oranla
  const baseAmp = reliefAmpM(viewMode);
  const amp = baseAmp * Math.max(0, depressionScale);
  const heights = surface.heights || [];
  const colors = resolveColors(surface);
  const previewUrl =
    surface.cleanedPreviewBase64 || surface.cleaned_preview_base64 || "";
  const kotPatches = collectKotPatches(surface, mapW, mapD, vertExag);

  let tex = null;
  if (!wireframe) {
    if (previewUrl) tex = makePreviewTexture(previewUrl);
    if (!tex) tex = makeMapDataTexture(colors, gw, gh);
  }

  const geo = new THREE.PlaneGeometry(mapW, mapD, gw - 1, gh - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const vertsX = gw;
  const vertsZ = gh;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let iy = 0; iy < vertsZ; iy++) {
    for (let ix = 0; ix < vertsX; ix++) {
      const vi = iy * vertsX + ix;
      const wx = pos.getX(vi);
      const wz = pos.getZ(vi);
      const base = burialReliefY(heightAt(heights, gw, gh, ix, iy)) * amp;
      const y = base + kotLiftAt(wx, wz, kotPatches);
      pos.setY(vi, y);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // Kontur aralığı: yüzey Y yayına göre ~8–12 çizgi hedefle
  const span = Number.isFinite(yMin) && Number.isFinite(yMax) ? yMax - yMin : 0;
  const contour = span > 0.05 ? { interval: niceStep(span / 9) } : null;

  const mat = makeMaterial(tex, wireframe, contour);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "groundMap";
  mesh.position.set(0, 0, 0);
  mesh.userData.mapTexture = wireframe ? null : tex;
  mesh.userData.reliefAmpM = amp;
  // Etiket gizlemesi için arazi örnekleyici verisi (sampleTerrainY kullanır)
  mesh.userData.relief = { heights, gw, gh, mapW, mapD, amp, kotPatches };

  // Yalnızca gerçek <img> tabanlı dokularda load bekle (DataTexture.image düz nesnedir)
  if (
    tex &&
    tex.image &&
    typeof tex.image.addEventListener === "function" &&
    !tex.image.complete
  ) {
    tex.image.addEventListener(
      "load",
      () => {
        tex.needsUpdate = true;
        mat.needsUpdate = true;
        invalidate();
      },
      { once: true }
    );
  }

  return { mesh, mapW, mapD, amp };
}

/**
 * Dünya (x,z) → arazi yüzey Y'si. Etiket gizleme testi kullanır.
 * Harita ayak izi dışında null döner.
 */
export function sampleTerrainY(mesh, wx, wz) {
  const r = mesh?.userData?.relief;
  if (!r) return null;
  const hw = r.mapW / 2;
  const hd = r.mapD / 2;
  if (wx < -hw || wx > hw || wz < -hd || wz > hd) return null;
  const fx = Math.min(Math.max(((wx + hw) / r.mapW) * (r.gw - 1), 0), r.gw - 1);
  const fz = Math.min(Math.max(((wz + hd) / r.mapD) * (r.gh - 1), 0), r.gh - 1);
  const ix = Math.min(Math.floor(fx), r.gw - 2);
  const iy = Math.min(Math.floor(fz), r.gh - 2);
  const tx = fx - ix;
  const tz = fz - iy;
  const lift = kotLiftAt(wx, wz, r.kotPatches);
  const cell = (cx, cz) => burialReliefY(heightAt(r.heights, r.gw, r.gh, cx, cz)) * r.amp + lift;
  const h00 = cell(ix, iy);
  const h10 = cell(ix + 1, iy);
  const h01 = cell(ix, iy + 1);
  const h11 = cell(ix + 1, iy + 1);
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

export function disposeGround(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose();
  const tex = mesh.userData?.mapTexture;
  if (tex) tex.dispose();
  if (mesh.material) {
    if (mesh.material.map && mesh.material.map !== tex) {
      mesh.material.map.dispose?.();
    }
    mesh.material.dispose();
  }
}

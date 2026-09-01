/**
 * xray.js — X-Ray / fresnel görünümü.
 *
 * Yapı mesh'lerini ışıklandırmadan, kameraya bakış açısına göre kenarlardan
 * parlayan yarı saydam "hologram" malzemeyle çizer. Zemin altındaki yapılar
 * kesit moduyla birlikte içten okunur hâle gelir.
 *
 * Kullanım:
 *   import { setXray, applyXrayIfActive } from "./xray.js";
 *   setXray(true);
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";

const FRESNEL_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRESNEL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 V = normalize(cameraPosition - vPosW);
  float ndv = abs(dot(normalize(vNormalW), V));
  float rim = pow(1.0 - ndv, 2.0);
  vec3 col = mix(uColor * 0.55, mix(uColor, vec3(1.0), 0.55), rim);
  float a = uOpacity * (0.16 + 0.84 * rim);
  gl_FragColor = vec4(col, a);
}
`;

/** Renk+opaklık başına tek ShaderMaterial → shader derlemesi ve program sayısı sınırlı. */
const _cache = new Map();

function keyOf(color, opacity) {
  return `${color.getHexString()}_${opacity.toFixed(2)}`;
}

function xrayMaterialFor(origMat) {
  const color =
    origMat?.color instanceof THREE.Color ? origMat.color.clone() : new THREE.Color(0x9fd8ff);
  const opacity = Math.min(Math.max(Number(origMat?.opacity ?? 0.5), 0.15), 1);
  const key = keyOf(color, opacity);
  let mat = _cache.get(key);
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      vertexShader: FRESNEL_VERT,
      fragmentShader: FRESNEL_FRAG,
      uniforms: {
        uColor: { value: color },
        uOpacity: { value: opacity },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.userData.votexXrayShared = true; // clearStructures bunu dispose etmesin
    _cache.set(key, mat);
  }
  return mat;
}

function isXrayable(obj) {
  return obj.isMesh && !obj.userData?.isBadge && !obj.userData?.isDetailLabel;
}

/** Açıkken tüm yapı mesh'lerine fresnel malzeme sarar; kapalıyken orijinale döner. */
export function applyXray(on) {
  const roots = [state.structureGroup, state.freeDrawGroup];
  for (const root of roots) {
    if (!root) continue;
    root.traverse((obj) => {
      if (!isXrayable(obj)) return;
      if (on) {
        if (!obj.userData._origMat) obj.userData._origMat = obj.material;
        obj.material = xrayMaterialFor(obj.userData._origMat);
      } else if (obj.userData._origMat) {
        obj.material = obj.userData._origMat;
        delete obj.userData._origMat;
      }
    });
  }
}

/** Toggle: sahnedeki mevcut yapılara uygular/geri alır. */
export function setXray(on) {
  state.xray = !!on;
  applyXray(state.xray);
  invalidate();
}

/** Sahne yeniden kurulunca (buildMesh) aktifse yeni mesh'lere yeniden uygula. */
export function applyXrayIfActive() {
  if (state.xray) applyXray(true);
}

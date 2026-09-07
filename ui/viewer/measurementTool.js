/**
 * measurementTool.js — 3D Ölçüm Araçları.
 *
 * 3D sahne üzerinde tıklayarak mesafe, alan ve hacim ölçümü.
 *
 * Kullanım:
 *   import { startMeasurement, stopMeasurement, isMeasuring } from "./measurementTool.js";
 *   startMeasurement();  // Ölçüm modunu aç
 *   stopMeasurement();   // Ölçüm modunu kapat
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";

// ── Durum ──
let _active = false;
let _points = [];
let _line = null;
let _markers = [];
let _resultSprite = null;
let _measureGroup = null;
const MARKER_COLOR = 0x00ff88;
const LINE_COLOR = 0x00ffaa;
const AREA_COLOR = 0x00aaff;

/**
 * Ölçüm modu aktif mi?
 */
export function isMeasuring() {
  return _active;
}

/**
 * Ölçüm modunu aç.
 */
export function startMeasurement() {
  if (_active) return;
  _active = true;
  _points = [];
  _cleanupGraphics();
  _createGroup();
  invalidate();
}

/**
 * Ölçüm modunu kapat ve sonuçları temizle.
 */
export function stopMeasurement() {
  _active = false;
  _points = [];
  _cleanupGraphics();
  invalidate();
}

/**
 * Sahne click handler — çağrılmadığında ölçüm çalışmaz.
 * main.js'den çağrılır.
 * @param {THREE.Intersection[]} intersects
 * @returns {boolean} Ölçüm tarafından işlendiyse true
 */
export function handleMeasurementClick(intersects) {
  if (!_active || !intersects.length) return false;

  const point = intersects[0].point.clone();
  _points.push(point);
  _addMarker(point);
  invalidate();

  // 2 nokta → mesafe
  if (_points.length === 2) {
    _drawLine(_points[0], _points[1]);
    const dist = _points[0].distanceTo(_points[1]);
    _showResult(`${dist.toFixed(2)} m`, _points[1]);

    // Otomatik bitir
    setTimeout(() => {
      stopMeasurement();
    }, 2000);
    return true;
  }

  return true;
}

/**
 * Mevcut ölçüm sonucunu string olarak al.
 * @returns {string|null}
 */
export function getMeasurementResult() {
  if (_points.length < 2) return null;
  const dist = _points[0].distanceTo(_points[1]);
  return `${dist.toFixed(2)} m`;
}

// ── Dahili ──

function _createGroup() {
  if (!state.scene) return;
  _measureGroup = new THREE.Group();
  _measureGroup.name = "measurement-tool";
  state.scene.add(_measureGroup);
}

function _cleanupGraphics() {
  if (_measureGroup) {
    if (state.scene) state.scene.remove(_measureGroup);
    _measureGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    _measureGroup = null;
  }
  _line = null;
  _markers = [];
  _resultSprite = null;
}

function _addMarker(point) {
  if (!_measureGroup) return;

  // Küre marker
  const geo = new THREE.SphereGeometry(0.15, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, depthTest: false });
  const sphere = new THREE.Mesh(geo, mat);
  sphere.position.copy(point);
  sphere.renderOrder = 999;
  _measureGroup.add(sphere);
  _markers.push(sphere);

  // Halka marker
  const ringGeo = new THREE.RingGeometry(0.3, 0.4, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: MARKER_COLOR,
    side: THREE.DoubleSide,
    depthTest: false,
    transparent: true,
    opacity: 0.6,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(point);
  ring.position.y += 0.05;
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 998;
  _measureGroup.add(ring);
}

function _drawLine(from, to) {
  if (!_measureGroup) return;

  const points = [];
  points.push(from.clone());
  points.push(to.clone());
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color: LINE_COLOR,
    depthTest: false,
    linewidth: 2,
  });
  _line = new THREE.Line(geo, mat);
  _line.renderOrder = 997;
  _measureGroup.add(_line);

  // Kesikli çizgi efekti — orta noktalara da marker ekle
  const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
  const midGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const midMat = new THREE.MeshBasicMaterial({ color: LINE_COLOR, depthTest: false });
  const midSphere = new THREE.Mesh(midGeo, midMat);
  midSphere.position.copy(mid);
  midSphere.renderOrder = 999;
  _measureGroup.add(midSphere);
}

function _showResult(text, position) {
  if (!_measureGroup) return;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 64;

  // Arka plan
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.roundRect(0, 0, 256, 64, 8);
  ctx.fill();

  // Border
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 2;
  ctx.roundRect(0, 0, 256, 64, 8);
  ctx.stroke();

  // Metin
  ctx.fillStyle = "#00ff88";
  ctx.font = "bold 28px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  _resultSprite = new THREE.Sprite(mat);
  _resultSprite.position.copy(position);
  _resultSprite.position.y += 0.8;
  _resultSprite.scale.set(2.5, 0.625, 1);
  _resultSprite.renderOrder = 1000;
  _measureGroup.add(_resultSprite);

  invalidate();
}

import * as THREE from "three";
import { getRgbForValue } from "./heatmap.js";

let scene, camera, renderer;
let pointCloudMesh = null;
let surfaceMesh = null;
let wireframeMesh = null;
let gridHelper = null;
let raycaster, mouse;
let currentDataset = null;
let onHoverCallback = null;

let options = {
  mode: "mesh", // 'mesh' or 'points'
  colormap: "geophysics",
  zScale: 1.0,
  pointSize: 0.35,
  showWireframe: false,
  showGrid: true,
  minCutoffRatio: 0.0,
  axisMode: "horizontal", // "horizontal", "swap_xy", "profile"
};

export function init3DScene(containerEl, hoverCb) {
  onHoverCallback = hoverCb;
  const width = containerEl.clientWidth || 800;
  const height = containerEl.clientHeight || 600;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040609);

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 8000);
  camera.position.set(80, 90, 140);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  containerEl.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight1.position.set(50, 100, 50);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.4);
  dirLight2.position.set(-50, -50, -50);
  scene.add(dirLight2);

  // Orbit controls via basic drag handlers
  setupOrbitControls(containerEl);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  window.addEventListener("resize", () => {
    const w = containerEl.clientWidth;
    const h = containerEl.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  animate();
}

export function updateOptions(newOpts) {
  options = { ...options, ...newOpts };
  if (currentDataset) {
    renderDataset(currentDataset);
  }
}

export function renderDataset(dataset) {
  currentDataset = dataset;
  clearSceneObjects();

  const { points, stats, surface } = dataset;
  if (!points || points.length === 0) return;

  const minAnom = stats.minAnomaly;
  const maxAnom = stats.maxAnomaly;
  const cutoffVal = minAnom + (maxAnom - minAnom) * options.minCutoffRatio;

  // Center X & Z map footprint around origin
  const centerX = (stats.minX + stats.maxX) * 0.5;
  const centerY = (stats.minY + stats.maxY) * 0.5;

  const sizeX = Math.max(10, stats.maxX - stats.minX);
  const sizeY = Math.max(10, stats.maxY - stats.minY);
  const maxDim = Math.max(sizeX, sizeY);

  // Position Camera based on axisMode
  if (options.axisMode === "profile") {
    // Frontal Profile Section View
    camera.position.set(0, -maxDim * 0.05, maxDim * 1.6);
    camera.lookAt(0, -maxDim * 0.3, 0);
  } else {
    // 3D Isometric Ground Surface Map View
    camera.position.set(maxDim * 0.7, maxDim * 0.45, maxDim * 0.9);
    camera.lookAt(0, -maxDim * 0.2, 0);
  }

  // 1. Surface Ground Plane (Yüzey Seviyesi Y = 0.0)
  if (options.showGrid) {
    gridHelper = new THREE.GridHelper(maxDim * 1.6, 20, 0x3edc8c, 0x1e293b);
    gridHelper.position.y = 0.0;
    scene.add(gridHelper);
  }

  // 2. Render Mode: Point Cloud (Subsurface Y <= 0)
  if (options.mode === "points") {
    const validPoints = points.filter((p) => p.anomaly >= cutoffVal);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(validPoints.length * 3);
    const colors = new Float32Array(validPoints.length * 3);

    validPoints.forEach((p, i) => {
      positions[i * 3] = p.x - centerX;
      positions[i * 3 + 1] = -Math.abs(p.z) * options.zScale; // Strictly Subsurface (<= 0.0)
      positions[i * 3 + 2] = p.y - centerY;

      const [r, g, b] = getRgbForValue(p.anomaly, minAnom, maxAnom, options.colormap, stats.meanAnomaly);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    });

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: options.pointSize,
      vertexColors: true,
      sizeAttenuation: true,
    });

    pointCloudMesh = new THREE.Points(geometry, material);
    scene.add(pointCloudMesh);
  }
  // 3. Render Mode: Interpolated Surface Mesh (Subsurface Y <= 0)
  else if (surface) {
    const { rows, cols, xCoords, yCoords, zMatrix, anomalyMatrix } = surface;

    const geometry = new THREE.PlaneGeometry(
      stats.maxX - stats.minX,
      stats.maxY - stats.minY,
      cols - 1,
      rows - 1
    );

    // Rotate plane so Z is height/depth
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx < posAttr.count) {
          const zVal = zMatrix[r][c];
          const anomVal = anomalyMatrix[r][c];

          posAttr.setY(idx, -Math.abs(zVal) * options.zScale); // Strictly Subsurface (<= 0.0)

          const [red, green, blue] = getRgbForValue(anomVal, minAnom, maxAnom, options.colormap, stats.meanAnomaly);
          colors[idx * 3] = red;
          colors[idx * 3 + 1] = green;
          colors[idx * 3 + 2] = blue;
        }
      }
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.4,
      metalness: 0.1,
      wireframe: false,
    });

    surfaceMesh = new THREE.Mesh(geometry, material);
    scene.add(surfaceMesh);

    if (options.showWireframe) {
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0x3aa8ff,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
      });
      wireframeMesh = new THREE.Mesh(geometry, wireMat);
      scene.add(wireframeMesh);
    }
  }

  // 4. Render 3D Volumetric Underground Structures & Metals
  if (dataset.structures && dataset.structures.length > 0) {
    renderStructures3D(dataset.structures, stats);
  }
}

let structureGroup = null;

function renderStructures3D(structures, stats) {
  if (!structures || structures.length === 0) return;
  structureGroup = new THREE.Group();

  const centerX = (stats.minX + stats.maxX) * 0.5;
  const centerY = (stats.minY + stats.maxY) * 0.5;

  structures.forEach((s) => {
    let meshColor = 0x3aa8ff; // Default cyan for rooms
    if (s.kind === "tomb") meshColor = 0x00f0ff;
    else if (s.kind === "tunnel") meshColor = 0xa855f7;
    else if (s.kind === "shaft") meshColor = 0xeab308;
    else if (s.kind === "metal") meshColor = 0xef4444;

    const w = s.widthDm;
    const l = s.lengthDm;
    // Yapı yüzeye kadar çıkar — roofDepthDm yüzeyden alt kenar (dm)
    const roofDm = Math.abs(s.roofDepthDm || 0);
    const floorDm = Math.abs(s.floorDepthDm || (roofDm + s.heightDm));
    const actualH = Math.max(floorDm - roofDm, 1.0) * options.zScale;
    const roofScaled = roofDm * options.zScale;

    let geom;
    if (s.kind === "shaft") {
      geom = new THREE.CylinderGeometry(w * 0.5, w * 0.5, actualH, 16);
    } else if (s.kind === "metal") {
      geom = new THREE.SphereGeometry(w * 0.5, 16, 16);
    } else {
      geom = new THREE.BoxGeometry(w, actualH, l);
    }

    const mat = new THREE.MeshStandardMaterial({
      color: meshColor,
      transparent: true,
      opacity: 0.55,
      roughness: 0.3,
      metalness: 0.2,
    });

    const mesh = new THREE.Mesh(geom, mat);
    // Y pozisyonu: yapının üstü Y=0'da (yüzey), alta doğru iner
    mesh.position.set(
      s.centerX - centerX,
      -(roofScaled + actualH / 2),
      s.centerY - centerY
    );

    // Edge wireframe highlight
    const edgeGeo = new THREE.EdgesGeometry(geom);
    const edgeMat = new THREE.LineBasicMaterial({ color: meshColor, linewidth: 2 });
    const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
    mesh.add(wireframe);

    structureGroup.add(mesh);
  });

  scene.add(structureGroup);
}

function clearSceneObjects() {
  if (pointCloudMesh) {
    scene.remove(pointCloudMesh);
    pointCloudMesh.geometry.dispose();
    pointCloudMesh.material.dispose();
    pointCloudMesh = null;
  }
  if (surfaceMesh) {
    scene.remove(surfaceMesh);
    surfaceMesh.geometry.dispose();
    surfaceMesh.material.dispose();
    surfaceMesh = null;
  }
  if (wireframeMesh) {
    scene.remove(wireframeMesh);
    wireframeMesh.geometry.dispose();
    wireframeMesh.material.dispose();
    wireframeMesh = null;
  }
  if (gridHelper) {
    scene.remove(gridHelper);
    gridHelper.dispose();
    gridHelper = null;
  }
  if (structureGroup) {
    scene.remove(structureGroup);
    structureGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    structureGroup = null;
  }
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function setupOrbitControls(containerEl) {
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };

  containerEl.addEventListener("mousedown", (e) => {
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  containerEl.addEventListener("mousemove", (e) => {
    const deltaMove = {
      x: e.clientX - previousMousePosition.x,
      y: e.clientY - previousMousePosition.y,
    };

    if (isDragging) {
      const deltaRotationQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          (deltaMove.y * Math.PI) / 180 * 0.4,
          (deltaMove.x * Math.PI) / 180 * 0.4,
          0,
          "XYZ"
        )
      );

      camera.position.applyQuaternion(deltaRotationQuaternion);
      camera.lookAt(0, 0, 0);
    }

    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  containerEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92;
      camera.position.multiplyScalar(zoomFactor);
    },
    { passive: false }
  );
}

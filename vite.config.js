import { defineConfig } from "vite";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { resolve } from "path";

/** build sırasında docs/ klasörünü dist/docs/ içine kopyala */
function copyDocs() {
  const src = resolve("docs");
  const dst = resolve("dist", "docs");
  try {
    mkdirSync(dst, { recursive: true });
    for (const f of readdirSync(src)) {
      if (statSync(resolve(src, f)).isFile()) {
        copyFileSync(resolve(src, f), resolve(dst, f));
      }
    }
  } catch { /* ilk build'te dist yoksa atla */ }
}

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust build çıktısı ve loglar izlenmesin — target/ yüz binlerce dosya
    // içerir; chokidar bunları izlerse dev sunucusu boşta CPU yakar.
    watch: {
      ignored: ["**/target/**", "**/dist/**", "**/logs/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    copyPublicDir: true,
    rollupOptions: {
      plugins: [
        { name: "copy-docs", closeBundle: copyDocs },
      ],
      output: {
        manualChunks: {
          three: ["three"],
          "three-addons": ["three/addons/controls/OrbitControls.js", "three/addons/environments/RoomEnvironment.js", "three/addons/objects/MarchingCubes.js"],
        },
      },
    },
  },
});

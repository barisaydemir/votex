# Agent Notes

## Validation
- Run `npm run test:js`, `npm run build`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `git diff --check` for the proportionate local validation path.
- Tauri release builds can outlive a terminal timeout; verify the freshness/hash of `src-tauri/target/release/votex.exe` before assuming a later NSIS/setup artifact contains the latest code.

## Legacy DIK architecture
- `legacyTargetSession` is the shared step/detection selection contract used by the panel and overlay through `legacyCaseStore`; do not add a parallel selection state when fixing selection or visibility.
- Merged-target selection is not fully migrated yet: `legacySelectedMergedTargetId` and `legacyMergedTargetViewMode` still have direct panel/overlay writes, so changes to merged-target selection must update those paths and their visibility tests together.
- `legacyMergedTargetModel` owns canonical `footprints` and `connectors`; the renderer must preserve measured footprints, connect only model-approved small horizontal gaps, and leave large gaps visibly empty.
- The default step direction is RTL and is coupled across `state.js`, `legacyGridTemplate.js`, `legacyDikOverlay.js`, and the HTML select; tests that assert the old order must pass `numberingDirection: "ltr"` explicitly.
- `legacyDikPanel.js` remains the large coordinator for rendering and event binding; prefer its existing controller/view modules for new behavior rather than adding another state calculation inside the panel.

## Versioning and packaging
- A Votex version bump must stay synchronized in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `modules/dft_packager/DFT_Suite.iss`, `modules/dft_packager/build_single_setup.py`, and `CHANGELOG.md`; refresh the lockfile with `npm install --package-lock-only --ignore-scripts`.
- The combined Windows installer is a direct-staging package: run `npm run build:installer` for the Tauri release/NSIS output, then `python modules/dft_packager/build_single_setup.py`; do not nest the Tauri installer inside the combined setup.
- `build_single_setup.py` runs a mandatory pre-packaging UI health check (tag balance + `main.layout` panel contract `panel-ops · panel-stage · panel-intel`) and aborts on violation; run `python modules/dft_packager/build_single_setup.py --check-ui` to run just the check (regression tests: `scripts/uiHealth.test.js`). Pass `--skip-tauri` to the script when `npm run build:installer` already produced fresh artifacts, to avoid the script's internal rebuild.
- Standing user rule: after every completed change/operation, bump the Votex version (synchronized as above) and produce the combined Windows setup — the user wants a fresh version + setup with each operation. Use `npm run release` (`scripts/release.mjs`) for this: it does the synchronized bump, CHANGELOG section, lockfile refresh, tests, NSIS + combined setup (`--skip-tauri`), and hash verification in one command.
- Inno Setup is machine-wide/admin-aware: install the app under `{autopf}` and keep DTA config, logs, memory, reports, and recordings in the user-writable `%APPDATA%\\DFT\\DerinTaramaAsistan` tree, not under Program Files.

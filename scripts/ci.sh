#!/usr/bin/env bash
# Votex CI Pipeline — Tüm testleri ve build'leri tek komutta çalıştır
# Kullanım: bash scripts/ci.sh [--skip-build] [--skip-installer] [--skip-rust]
#
# Aşamalar:
#   1. JS Testleri (vitest)
#   2. Rust Testleri (cargo test --lib)
#   3. Rust Check (cargo check)
#   4. Frontend Build (vite build)
#   5. NSIS Installer (tauri build --bundles nsis) — opsiyonel

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Flags ──
SKIP_BUILD=false
SKIP_INSTALLER=false
SKIP_RUST=false

for arg in "$@"; do
    case $arg in
        --skip-build)     SKIP_BUILD=true ;;
        --skip-installer) SKIP_INSTALLER=true ;;
        --skip-rust)      SKIP_RUST=true ;;
        -h|--help)
            echo "Kullanım: bash scripts/ci.sh [--skip-build] [--skip-installer] [--skip-rust]"
            exit 0
            ;;
    esac
done

# ── Renkli çıktı ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

step_ok()   { echo -e "  ${GREEN}✅ $1${NC}"; }
step_fail() { echo -e "  ${RED}❌ $1${NC}"; }
step_skip() { echo -e "  ${YELLOW}⏭️  $1${NC}"; }
step_hdr()  { echo -e "\n${CYAN}═══ ADIM $1 ═══${NC}"; echo -e "  ${BOLD}$2${NC}"; }

# ── Sayaçlar ──
TOTAL_START=$SECONDS
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
declare -a RESULTS=()

run_step() {
    local name="$1"
    local result="$2"
    local detail="$3"
    
    if [ "$result" = "PASS" ]; then
        step_ok "$detail"
        ((PASS_COUNT++))
    elif [ "$result" = "SKIP" ]; then
        step_skip "$detail"
        ((SKIP_COUNT++))
    else
        step_fail "$detail"
        ((FAIL_COUNT++))
    fi
    RESULTS+=("$result|$name|$detail")
}

# ══════════════════════════════════════════════════════════════
# ADIM 1: JS Testleri
# ══════════════════════════════════════════════════════════════
step_hdr 1 "JS Testleri (vitest)"
STEP_START=$SECONDS

cd "$PROJECT_ROOT"
JS_OUTPUT=$(npm run test:js 2>&1) || true
JS_EXIT=$?

if [ $JS_EXIT -eq 0 ]; then
    JS_PASSED=$(echo "$JS_OUTPUT" | grep -oP 'Tests\s+\K\d+(?=\s+passed)' || echo "??")
    ELAPSED=$(( SECONDS - STEP_START ))
    run_step "JS Test" "PASS" "${JS_PASSED} test geçti (${ELAPSED}s)"
else
    ELAPSED=$(( SECONDS - STEP_START ))
    run_step "JS Test" "FAIL" "JS testleri başarısız (${ELAPSED}s)"
    echo "$JS_OUTPUT" | tail -5
fi

# ══════════════════════════════════════════════════════════════
# ADIM 2: Rust Testleri
# ══════════════════════════════════════════════════════════════
if [ "$SKIP_RUST" = false ]; then
    step_hdr 2 "Rust Testleri (cargo test --lib)"
    STEP_START=$SECONDS
    
    cd "$PROJECT_ROOT/src-tauri"
    RUST_OUTPUT=$(cargo test --lib 2>&1) || true
    RUST_EXIT=$?
    
    if [ $RUST_EXIT -eq 0 ]; then
        RUST_PASSED=$(echo "$RUST_OUTPUT" | grep -oP 'test result: ok\. \K\d+' || echo "??")
        ELAPSED=$(( SECONDS - STEP_START ))
        run_step "Rust Test" "PASS" "${RUST_PASSED} test geçti (${ELAPSED}s)"
    else
        ELAPSED=$(( SECONDS - STEP_START ))
        run_step "Rust Test" "FAIL" "Rust testleri başarısız (${ELAPSED}s)"
        echo "$RUST_OUTPUT" | grep -E "FAILED|failures:" | head -5
    fi
else
    step_hdr 2 "Rust Testleri — ATLANDI"
    run_step "Rust Test" "SKIP" "parameter --skip-rust"
fi

# ══════════════════════════════════════════════════════════════
# ADIM 3: Rust Check
# ══════════════════════════════════════════════════════════════
if [ "$SKIP_RUST" = false ]; then
    step_hdr 3 "Rust Check (cargo check)"
    STEP_START=$SECONDS
    
    cd "$PROJECT_ROOT/src-tauri"
    CHECK_OUTPUT=$(cargo check 2>&1) || true
    CHECK_EXIT=$?
    
    if [ $CHECK_EXIT -eq 0 ]; then
        WARNINGS=$(echo "$CHECK_OUTPUT" | grep -c "^warning:" || echo "0")
        ELAPSED=$(( SECONDS - STEP_START ))
        run_step "Rust Check" "PASS" "0 hata, ${WARNINGS} uyarı (${ELAPSED}s)"
    else
        ELAPSED=$(( SECONDS - STEP_START ))
        run_step "Rust Check" "FAIL" "Cargo check başarısız (${ELAPSED}s)"
    fi
else
    step_hdr 3 "Rust Check — ATLANDI"
    run_step "Rust Check" "SKIP" "parameter --skip-rust"
fi

# ══════════════════════════════════════════════════════════════
# ADIM 4: Frontend Build
# ══════════════════════════════════════════════════════════════
if [ "$SKIP_BUILD" = false ]; then
    step_hdr 4 "Frontend Build (vite build)"
    STEP_START=$SECONDS
    
    cd "$PROJECT_ROOT"
    BUILD_OUTPUT=$(npm run build 2>&1) || true
    BUILD_EXIT=$?
    
    if [ $BUILD_EXIT -eq 0 ]; then
        ELAPSED=$(( SECONDS - STEP_START ))
        run_step "Frontend Build" "PASS" "Build başarılı (${ELAPSED}s)"
    else
        ELAPSED=$(( SECONDS - STEP_START ))
        run_step "Frontend Build" "FAIL" "Build başarısız (${ELAPSED}s)"
    fi
else
    step_hdr 4 "Frontend Build — ATLANDI"
    run_step "Frontend Build" "SKIP" "parameter --skip-build"
fi

# ══════════════════════════════════════════════════════════════
# ADIM 5: NSIS Installer
# ══════════════════════════════════════════════════════════════
if [ "$SKIP_BUILD" = false ] && [ "$SKIP_INSTALLER" = false ]; then
    step_hdr 5 "NSIS Installer (tauri build)"
    STEP_START=$SECONDS
    
    cd "$PROJECT_ROOT"
    INSTALLER_OUTPUT=$(npm run build:installer 2>&1) || true
    INSTALLER_EXIT=$?
    
    if [ $INSTALLER_EXIT -eq 0 ]; then
        EXE_FILE=$(ls -t "$PROJECT_ROOT/target/release/bundle/nsis/"*.exe 2>/dev/null | head -1)
        if [ -n "$EXE_FILE" ]; then
            SIZE_MB=$(du -m "$EXE_FILE" | cut -f1)
            EXE_NAME=$(basename "$EXE_FILE")
            ELAPSED=$(( SECONDS - STEP_START ))
            run_step "NSIS Installer" "PASS" "${EXE_NAME} (${SIZE_MB} MB, ${ELAPSED}s)"
        else
            ELAPSED=$(( SECONDS - STEP_START ))
            run_step "NSIS Installer" "PASS" "Installer derlendi (${ELAPSED}s)"
        fi
    else
        ELAPSED=$(( SECONDS - STEP_START ))
        run_step "NSIS Installer" "FAIL" "Installer başarısız (${ELAPSED}s)"
    fi
else
    step_hdr 5 "NSIS Installer — ATLANDI"
    run_step "NSIS Installer" "SKIP" "parameter --skip-installer"
fi

# ══════════════════════════════════════════════════════════════
# ÖZET RAPOR
# ══════════════════════════════════════════════════════════════
TOTAL_ELAPSED=$(( SECONDS - TOTAL_START ))

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           CI PIPELINE ÖZET RAPORU               ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════════╣${NC}"

for r in "${RESULTS[@]}"; do
    IFS='|' read -r status name detail <<< "$r"
    case $status in
        PASS) icon="✅" color=$GREEN ;;
        FAIL) icon="❌" color=$RED ;;
        ERROR) icon="💥" color=$RED ;;
        SKIP) icon="⏭️ " color=$YELLOW ;;
    esac
    printf "${color}║  %s %-18s %-20s ║${NC}\n" "$icon" "$name" "$detail"
done

echo -e "${CYAN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "║  Toplam Süre: ${TOTAL_ELAPSED}s"

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}║  🎉 TÜM TESTLER BAŞARILI                        ║${NC}"
else
    echo -e "${RED}║  ⚠️  ${FAIL_COUNT} TEST BAŞARISIZ                      ║${NC}"
fi

echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"

# Çıkış kodu
[ $FAIL_COUNT -eq 0 ] && exit 0 || exit 1

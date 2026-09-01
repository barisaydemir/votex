# Votex CI Pipeline — Tüm testleri ve build'leri tek komutta çalıştır
# Kullanım: .\scripts\ci.ps1 [-SkipBuild] [-SkipInstaller] [-SkipRust]
#
# Aşamalar:
#   1. JS Testleri (vitest)
#   2. Rust Testleri (cargo test)
#   3. Rust Check (cargo check)
#   4. Frontend Build (vite build)
#   5. NSIS Installer (tauri build --bundles nsis) — opsiyonel

param(
    [switch]$SkipBuild,
    [switch]$SkipInstaller,
    [switch]$SkipRust
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# ── Renkli çıktı yardımcıları ──
function Write-Step($step, $msg) {
    Write-Host "`n═══ ADIM $step ═══" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor White
}

function Write-Ok($msg) {
    Write-Host "  ✅ $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "  ❌ $msg" -ForegroundColor Red
}

function Write-Skip($msg) {
    Write-Host "  ⏭️  $msg" -ForegroundColor Yellow
}

# ── Sayaçlar ──
$totalStart = Get-Date
$results = @()

# ══════════════════════════════════════════════════════════════
# ADIM 1: JS Testleri
# ══════════════════════════════════════════════════════════════
Write-Step 1 "JS Testleri (vitest)"
$stepStart = Get-Date
Push-Location $projectRoot

try {
    $output = npm run test:js 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -eq 0) {
        $passed = ($output | Select-String "Tests\s+(\d+) passed").Matches[0].Groups[1].Value
        Write-Ok "$passed/?? test geçti ($(([Get-Date] - $stepStart).TotalSeconds.ToString('F1'))s)"
        $results += @{ step = "JS Test"; status = "PASS"; detail = "$passed tests" }
    } else {
        Write-Fail "JS testleri başarısız (exit $exitCode)"
        Write-Host $output -ForegroundColor DarkGray
        $results += @{ step = "JS Test"; status = "FAIL"; detail = "exit $exitCode" }
    }
} catch {
    Write-Fail "JS test hatası: $_"
    $results += @{ step = "JS Test"; status = "ERROR"; detail = $_.Exception.Message }
}

Pop-Location

# ══════════════════════════════════════════════════════════════
# ADIM 2: Rust Testleri
# ══════════════════════════════════════════════════════════════
if (-not $SkipRust) {
    Write-Step 2 "Rust Testleri (cargo test --lib)"
    $stepStart = Get-Date
    Push-Location "$projectRoot\src-tauri"
    
    try {
        $output = cargo test --lib 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -eq 0) {
            $passed = ($output | Select-String "test result: ok\. (\d+) passed").Matches[0].Groups[1].Value
            Write-Ok "$passed Rust test geçti ($(([Get-Date] - $stepStart).TotalSeconds.ToString('F1'))s)"
            $results += @{ step = "Rust Test"; status = "PASS"; detail = "$passed tests" }
        } else {
            Write-Fail "Rust testleri başarısız (exit $exitCode)"
            Write-Host ($output | Select-String "FAILED|failures:" | Select-Object -First 5) -ForegroundColor DarkGray
            $results += @{ step = "Rust Test"; status = "FAIL"; detail = "exit $exitCode" }
        }
    } catch {
        Write-Fail "Rust test hatası: $_"
        $results += @{ step = "Rust Test"; status = "ERROR"; detail = $_.Exception.Message }
    }
    
    Pop-Location
} else {
    Write-Step 2 "Rust Testleri — ATLANDI (--SkipRust)"
    Write-Skip "Rust testleri atlandı"
    $results += @{ step = "Rust Test"; status = "SKIP"; detail = "parameter" }
}

# ══════════════════════════════════════════════════════════════
# ADIM 3: Rust Check
# ══════════════════════════════════════════════════════════════
if (-not $SkipRust) {
    Write-Step 3 "Rust Check (cargo check)"
    $stepStart = Get-Date
    Push-Location "$projectRoot\src-tauri"
    
    try {
        $output = cargo check 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -eq 0) {
            $warnings = ([regex]::Matches($output, "warning:")).Count
            Write-Ok "0 hata, $warnings uyarı ($(([Get-Date] - $stepStart).TotalSeconds.ToString('F1'))s)"
            $results += @{ step = "Rust Check"; status = "PASS"; detail = "$warnings warnings" }
        } else {
            Write-Fail "Cargo check başarısız"
            Write-Host ($output | Select-String "^error" | Select-Object -First 5) -ForegroundColor DarkGray
            $results += @{ step = "Rust Check"; status = "FAIL"; detail = "exit $exitCode" }
        }
    } catch {
        Write-Fail "Cargo check hatası: $_"
        $results += @{ step = "Rust Check"; status = "ERROR"; detail = $_.Exception.Message }
    }
    
    Pop-Location
} else {
    Write-Step 3 "Rust Check — ATLANDI"
    Write-Skip "Rust check atlandı"
    $results += @{ step = "Rust Check"; status = "SKIP"; detail = "parameter" }
}

# ══════════════════════════════════════════════════════════════
# ADIM 4: Frontend Build
# ══════════════════════════════════════════════════════════════
if (-not $SkipBuild) {
    Write-Step 4 "Frontend Build (vite build)"
    $stepStart = Get-Date
    Push-Location $projectRoot
    
    try {
        $output = npm run build 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -eq 0) {
            $time = ($output | Select-String "built in ([\d.]+)s").Matches[0].Groups[1].Value
            Write-Ok "Build başarılı ($(([Get-Date] - $stepStart).TotalSeconds.ToString('F1'))s)"
            $results += @{ step = "Frontend Build"; status = "PASS"; detail = "${time}s" }
        } else {
            Write-Fail "Frontend build başarısız"
            $results += @{ step = "Frontend Build"; status = "FAIL"; detail = "exit $exitCode" }
        }
    } catch {
        Write-Fail "Build hatası: $_"
        $results += @{ step = "Frontend Build"; status = "ERROR"; detail = $_.Exception.Message }
    }
    
    Pop-Location
} else {
    Write-Step 4 "Frontend Build — ATLANDI"
    Write-Skip "Build atlandı"
    $results += @{ step = "Frontend Build"; status = "SKIP"; detail = "parameter" }
}

# ══════════════════════════════════════════════════════════════
# ADIM 5: NSIS Installer
# ══════════════════════════════════════════════════════════════
if (-not $SkipBuild -and -not $SkipInstaller) {
    Write-Step 5 "NSIS Installer (tauri build)"
    $stepStart = Get-Date
    Push-Location $projectRoot
    
    try {
        $output = npm run build:installer 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -eq 0) {
            $exeFile = Get-ChildItem "$projectRoot\target\release\bundle\nsis\*.exe" | 
                Sort-Object LastWriteTime -Descending | 
                Select-Object -First 1
            
            if ($exeFile) {
                $sizeMB = [math]::Round($exeFile.Length / 1MB, 0)
                Write-Ok "$($exeFile.Name) ($sizeMB MB) ($(([Get-Date] - $stepStart).TotalSeconds.ToString('F1'))s)"
                $results += @{ step = "NSIS Installer"; status = "PASS"; detail = "$($exeFile.Name) ($sizeMB MB)" }
            } else {
                Write-Ok "Installer derlendi ($(([Get-Date] - $stepStart).TotalSeconds.ToString('F1'))s)"
                $results += @{ step = "NSIS Installer"; status = "PASS"; detail = "built" }
            }
        } else {
            Write-Fail "Installer derleme başarısız"
            $results += @{ step = "NSIS Installer"; status = "FAIL"; detail = "exit $exitCode" }
        }
    } catch {
        Write-Fail "Installer hatası: $_"
        $results += @{ step = "NSIS Installer"; status = "ERROR"; detail = $_.Exception.Message }
    }
    
    Pop-Location
} else {
    Write-Step 5 "NSIS Installer — ATLANDI"
    Write-Skip "Installer atlandı"
    $results += @{ step = "NSIS Installer"; status = "SKIP"; detail = "parameter" }
}

# ══════════════════════════════════════════════════════════════
# ÖZET RAPOR
# ══════════════════════════════════════════════════════════════
$totalDuration = (Get-Date) - $totalStart

Write-Host "`n╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║           CI PIPELINE ÖZET RAPORU               ║" -ForegroundColor Cyan
Write-Host "╠══════════════════════════════════════════════════╣" -ForegroundColor Cyan

$passCount = ($results | Where-Object { $_.status -eq "PASS" }).Count
$failCount = ($results | Where-Object { $_.status -eq "FAIL" }).Count
$errCount = ($results | Where-Object { $_.status -eq "ERROR" }).Count
$skipCount = ($results | Where-Object { $_.status -eq "SKIP" }).Count

foreach ($r in $results) {
    $icon = switch ($r.status) {
        "PASS"   { "✅" }
        "FAIL"   { "❌" }
        "ERROR"  { "💥" }
        "SKIP"   { "⏭️ " }
    }
    $color = switch ($r.status) {
        "PASS"   { "Green" }
        "FAIL"   { "Red" }
        "ERROR"  { "Red" }
        "SKIP"   { "Yellow" }
    }
    Write-Host ("║  {0} {1,-18} {2,-20} ║" -f $icon, $r.step, $r.detail) -ForegroundColor $color
}

Write-Host "╠══════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host ("║  Toplam Süre: {0:F1}s                            ║" -f $totalDuration.TotalSeconds) -ForegroundColor White

$allPassed = $failCount -eq 0 -and $errCount -eq 0
if ($allPassed) {
    Write-Host "║  🎉 TÜM TESTLER BAŞARILI                        ║" -ForegroundColor Green
} else {
    Write-Host "║  ⚠️  BAZI TESTLER BAŞARISIZ                      ║" -ForegroundColor Red
}

Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan

# Çıkış kodu
if ($allPassed) { exit 0 } else { exit 1 }

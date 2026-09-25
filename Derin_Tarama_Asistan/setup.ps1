Write-Host "J.A.R.V.I.S Windows kurulumu" -ForegroundColor Cyan

$ErrorActionPreference = "Stop"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python bulunamadi. Python 3.10+ kurup tekrar deneyin."
}

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

Write-Host ""
Write-Host "Kurulum tamamlandi. Baslatmak icin:" -ForegroundColor Green
Write-Host "python main.py"

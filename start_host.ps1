param([switch]$NoElevate)

$PythonPath = "C:\Users\dodo\AppData\Local\Programs\Python\Python313\python.exe"
if (-not (Test-Path $PythonPath)) { $PythonPath = "py" }

# Auto-elevate to admin if not already
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin -and -not $NoElevate) {
    Write-Host "Demande d'elevation admin (necessaire pour temperatures WMI)..." -ForegroundColor Yellow
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -NoElevate"
    $psi.Verb = "runas"
    try {
        [System.Diagnostics.Process]::Start($psi) | Out-Null
        exit
    } catch {
        Write-Host "Elevation annulee ou impossible - demarrage sans admin" -ForegroundColor Red
    }
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  DeckLink Host" -ForegroundColor Cyan
if ($IsAdmin) { Write-Host "  Mode: ADMIN" -ForegroundColor Green } else { Write-Host "  Mode: utilisateur" -ForegroundColor Yellow }
Write-Host "==========================================" -ForegroundColor Cyan

Write-Host "[1/2] Verification des dependances..." -ForegroundColor Yellow
& $PythonPath -m pip install -r host\requirements.txt 2>&1 | Out-Null

Write-Host "[2/2] Demarrage du serveur..." -ForegroundColor Green
& $PythonPath host\server.py

Read-Host "Appuyez sur Entree pour quitter"

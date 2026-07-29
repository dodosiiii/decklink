@echo off
title DeckLink Host
cd /d "%~dp0"

echo ==========================================
echo   DeckLink Host - Demarrage...
echo ==========================================
echo.

if not exist "%cd%\host\requirements.txt" (
    echo Erreur: Fichier requirements.txt introuvable
    pause
    exit /b 1
)

echo [1/2] Verification des dependances...
pip install -r host\requirements.txt
if %errorlevel% neq 0 (
    echo Erreur lors de l'installation des dependances
    pause
    exit /b 1
)

echo.
echo [2/2] Demarrage du serveur...
echo.
echo    Interface disponible sur le reseau
echo    Pour vous connecter, ouvrez sur votre client:
echo    http://<IP_DE_CETTE_MACHINE>:5000
echo.
echo    Appuyez sur Ctrl+C pour arreter
echo ==========================================
echo.

python host\server.py
if %errorlevel% neq 0 (
    echo.
    echo Tentative avec py...
    py host\server.py
)
if %errorlevel% neq 0 (
    echo.
    echo Erreur: Verifiez que Python est installe
    pause
)
pause

@echo off
chcp 65001 >nul
title SCALP FUSION v1.1 - Tableau de Bord Local MT5 Exness
echo ========================================================
echo   SCALP FUSION v1.1 - Installation et lancement local
echo ========================================================
echo.

set PY_CMD=
where python >nul 2>nul
if %errorlevel% equ 0 (
    set PY_CMD=python
) else (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set PY_CMD=py -3
    )
)

if "%PY_CMD%"=="" (
    echo [ERREUR] Python 3.10+ n'est pas installe ou absent du PATH.
    echo Telechargez Python 64-bit sur https://www.python.org/downloads/
    echo IMPORTANT : cochez "Add python.exe to PATH" lors de l'installation.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Creation de l'environnement virtuel .venv...
    %PY_CMD% -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERREUR] Echec de creation de .venv.
        pause
        exit /b 1
    )
)

call .venv\Scripts\activate.bat

echo [2/3] Verification / installation des dependances Python...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERREUR] Echec de pip install. Verifiez votre connexion Internet et Python 64-bit.
    pause
    exit /b 1
)

echo.
echo [3/3] Demarrage du serveur local SCALP FUSION sur http://127.0.0.1:8765
echo       - Ouvrez MetaTrader 5 Exness et connectez votre compte.
echo       - Le tableau de bord s'ouvrira automatiquement dans votre navigateur.
echo       - Laissez cette fenetre ouverte pendant l'utilisation.
echo.
python -m uvicorn mt5_server:app --host 127.0.0.1 --port 8765
pause

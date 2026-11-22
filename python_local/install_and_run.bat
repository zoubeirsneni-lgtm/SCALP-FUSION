@echo off
title SCALP FUSION v1.1 - Pont Local MT5 Exness
echo ========================================================
echo   SCALP FUSION v1.1 - Installation et lancement MT5
echo ========================================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Python n'est pas installe ou absent du PATH.
    echo Telechargez Python 3.10+ (64-bit) sur https://www.python.org/
    pause
    exit /b 1
)

if not exist ".venv" (
    echo [1/3] Creation de l'environnement virtuel .venv...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

echo [2/3] Installation / mise a jour des dependances (MetaTrader5, FastAPI, Uvicorn)...
python -m pip install --upgrade pip >nul
pip install -r requirements.txt

echo.
echo [3/3] Demarrage du pont local MT5 sur http://127.0.0.1:8765
echo       Assurez-vous que votre terminal MT5 Exness est ouvert et connecte.
echo       Laissez cette fenetre ouverte pendant l'utilisation du tableau de bord.
echo.
uvicorn mt5_server:app --host 127.0.0.1 --port 8765
pause

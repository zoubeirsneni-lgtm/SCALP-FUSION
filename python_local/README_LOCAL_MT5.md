# SCALP FUSION v1.1 — Installation 100 % locale sur PC (MetaTrader 5 Exness)

Ce pack contient **tout le nécessaire** pour exécuter **SCALP FUSION v1.1** directement sur votre ordinateur :
- **L'interface complète du tableau de bord** (dossier `dist/`)
- **Le pont Python local** (`mt5_server.py` + `scalp_fusion_engine.py`) connecté directement à votre terminal **MetaTrader 5 Exness**

---

## Prérequis (Windows)

1. **MetaTrader 5 (Exness)** installé, ouvert et connecté à votre compte (Démo ou Réel).
2. **Python 3.10 ou supérieur (64-bit)** installé sur Windows.
   - Lors de l'installation de Python, cochez bien **`Add python.exe to PATH`**.

---

## Démarrage en 1 clic (Windows)

1. **Décompressez** tout le fichier `.zip` dans un dossier sur votre PC (ex: `C:\SCALP_FUSION\`).
2. Vérifiez que **MetaTrader 5 Exness** est ouvert.
3. Double-cliquez sur **`install_and_run.bat`**.

Le script va automatiquement :
- Créer un environnement Python isolé (`.venv`)
- Installer `MetaTrader5`, `fastapi`, `uvicorn` et `pydantic`
- Démarrer le serveur local sur **`http://127.0.0.1:8765`**
- Ouvrir le tableau de bord directement dans votre navigateur.

---

## Lancement manuel (Invite de commandes / PowerShell)

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn mt5_server:app --host 127.0.0.1 --port 8765
```

Puis ouvrez **`http://127.0.0.1:8765`** dans votre navigateur (Chrome / Edge).

---

## Notes Exness & Timeframes

- **Suffixes Exness** : saisissez `EURUSDm`, `XAUUSDm`, `BTCUSDm` (ou même `EURUSD`) — le pont Python résout automatiquement le symbole actif dans votre Market Watch MT5.
- **Timeframes `1M`, `3M`, `5M`, `10M`, `15M`** : lus directement depuis votre terminal MT5 via `mt5.copy_rates_from_pos`.
- **Timeframe `30s`** : agrégé en temps réel à partir des ticks MT5 (`mt5.copy_ticks_range`) sur les prix `Bid`.
- **Fallback marché public** : si MT5 est fermé temporairement, le serveur local bascule automatiquement sur le flux public (Binance pour Crypto, CME Futures via Yahoo Finance pour Forex/Métaux).

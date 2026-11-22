# SCALP FUSION v1.1 — Installation locale avec MetaTrader 5 (Exness)

Ce dossier contient le pont Python local qui connecte directement votre terminal **MetaTrader 5 Exness** au tableau de bord **SCALP FUSION v1.1**.

## Prérequis (Windows)

1. **MetaTrader 5 Exness** installé, ouvert et connecté à votre compte (Démo ou Réel).
   - Dans MT5 : `Outils > Options > Expert Advisors` — il n'est pas nécessaire d'activer le trading algorithmique pour la lecture des prix, il suffit que le terminal soit connecté au serveur Exness.
2. **Python 3.10 ou supérieur (64-bit)** installé sur Windows (`Add Python to PATH` coché).

## Lancement rapide (Windows)

Double-cliquez simplement sur **`install_and_run.bat`**.

Le script va :
1. Créer un environnement virtuel `.venv` isolé.
2. Installer `MetaTrader5`, `fastapi`, `uvicorn` et `pydantic`.
3. Démarrer le serveur local sur **`http://127.0.0.1:8765`**.

## Lancement manuel

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn mt5_server:app --host 127.0.0.1 --port 8765
```

## Notes sur les paires Exness et Timeframes

- **Suffixes Exness** : Si votre compte utilise `EURUSDm`, `XAUUSDm` (Standard/Pro/Raw) ou `EURUSDc` (Standard Cent), vous pouvez saisir soit le nom exact (`EURUSDm`), soit le nom générique (`EURUSD`) — le pont Python résout automatiquement le suffixe dans votre Market Watch.
- **Timeframes `1M`, `3M`, `5M`, `10M`, `15M`** : lus directement via `mt5.copy_rates_from_pos`.
- **Timeframe `30s`** : agrégé en temps réel à partir des ticks MT5 (`mt5.copy_ticks_range`) sur les prix `Bid`.

## Utilisation 100 % hors-ligne en local

Si vous buildez l'application web (`npm run build`) et copiez le dossier `dist/` à côté de `mt5_server.py`, ouvrir **`http://127.0.0.1:8765`** dans votre navigateur lancera directement tout le tableau de bord en local sans aucune dépendance externe.

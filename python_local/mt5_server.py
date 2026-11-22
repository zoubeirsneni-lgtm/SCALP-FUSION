"""
SCALP FUSION v1.1 — Pont Local MetaTrader 5 (Exness)
Serveur FastAPI local qui lit directement le terminal MT5 Exness ouvert sur Windows :
  - Timeframes natifs : 1M, 3M, 5M, 10M, 15M
  - Timeframe 30s : agrégation temps réel des ticks MT5 (copy_ticks_range)
  - Résolution automatique des suffixes Exness (EURUSDm, EURUSDc, etc.)
  - Calcul complet SCALP FUSION v1.1 + scan multi-paires

Lancement :
  uvicorn mt5_server:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    import MetaTrader5 as mt5
except ImportError:  # pragma: no cover
    mt5 = None  # type: ignore

from scalp_fusion_engine import (
    ScalpFusionSettings,
    TIMEFRAME_SECONDS,
    aggregate_ticks_to_30s,
    compute_scalp_fusion,
)

app = FastAPI(title="SCALP FUSION MT5 Exness Bridge", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_pna_header(request: Request, call_next):
    # Autorise Chrome (Private Network Access) lorsque le dashboard web appelle http://127.0.0.1:8765
    if request.method == "OPTIONS":
        response = JSONResponse(content={})
    else:
        response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response


def ensure_mt5() -> None:
    if mt5 is None:
        raise HTTPException(
            status_code=500,
            detail="Le package Python 'MetaTrader5' n'est pas installé. Exécutez: pip install -r requirements.txt",
        )
    if not mt5.initialize():
        err = mt5.last_error()
        raise HTTPException(
            status_code=503,
            detail=f"Impossible de se connecter à MetaTrader 5 (vérifiez que MT5 Exness est ouvert). Détail: {err}",
        )


def resolve_exness_symbol(requested: str) -> str:
    """Résout le symbole exact dans MT5 Exness (gère les suffixes m, c, .r, etc.)."""
    clean = requested.strip()
    if not clean:
        raise HTTPException(status_code=400, detail="Symbole vide.")

    candidates = [clean]
    base = clean
    for sfx in ("m", "c", ".r", "_m"):
        if clean.endswith(sfx) and len(clean) > len(sfx) + 3:
            base = clean[: -len(sfx)]
            break
    if base != clean:
        candidates.append(base)
    for sfx in ("m", "c", ".r", "_m"):
        cand = f"{base}{sfx}"
        if cand not in candidates:
            candidates.append(cand)

    for cand in candidates:
        info = mt5.symbol_info(cand)
        if info is not None:
            if not info.visible:
                mt5.symbol_select(cand, True)
            return cand

    # Recherche insensible à la casse dans les symboles MT5
    all_syms = mt5.symbols_get()
    if all_syms:
        upper_req = clean.upper()
        upper_base = base.upper()
        for s in all_syms:
            if s.name.upper() == upper_req:
                mt5.symbol_select(s.name, True)
                return s.name
        for s in all_syms:
            if s.name.upper().startswith(upper_base):
                mt5.symbol_select(s.name, True)
                return s.name

    raise HTTPException(
        status_code=404,
        detail=f"Symbole '{requested}' introuvable dans votre terminal MT5 Exness.",
    )


def fetch_mt5_candles(symbol: str, timeframe: str, count: int = 500) -> Dict[str, Any]:
    ensure_mt5()
    resolved = resolve_exness_symbol(symbol)

    if timeframe == "30s":
        now_utc = datetime.now(timezone.utc)
        # Fenêtre suffisante pour obtenir ~500 bougies de 30s (~4h30)
        hours_needed = max(5, int((count * 30) / 3600) + 1)
        utc_from = now_utc - timedelta(hours=hours_needed)
        utc_to = now_utc + timedelta(minutes=5)
        ticks = mt5.copy_ticks_range(resolved, utc_from, utc_to, mt5.COPY_TICKS_ALL)
        candles = aggregate_ticks_to_30s(ticks, max_bars=count)
        if not candles:
            raise HTTPException(
                status_code=404,
                detail=f"Aucun tick reçu pour {resolved} (marché fermé ou symbole inactif).",
            )
        return {"symbol": resolved, "candles": candles}

    tf_map = {
        "1M": mt5.TIMEFRAME_M1,
        "3M": mt5.TIMEFRAME_M3,
        "5M": mt5.TIMEFRAME_M5,
        "10M": mt5.TIMEFRAME_M10,
        "15M": mt5.TIMEFRAME_M15,
    }
    if timeframe not in tf_map:
        raise HTTPException(status_code=400, detail=f"Timeframe non supporté: {timeframe}")

    rates = mt5.copy_rates_from_pos(resolved, tf_map[timeframe], 0, count)
    if rates is None or len(rates) == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Aucune bougie {timeframe} disponible pour {resolved}.",
        )

    tf_sec = TIMEFRAME_SECONDS[timeframe]
    now_ts = int(time.time())
    candles: List[Dict[str, Any]] = []
    total = len(rates)
    for idx, r in enumerate(rates):
        bar_ts = int(r["time"])
        is_forming = (idx == total - 1) and (now_ts < bar_ts + tf_sec)
        candles.append(
            {
                "time": bar_ts,
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": float(r["tick_volume"]),
                "isForming": is_forming,
            }
        )
    return {"symbol": resolved, "candles": candles}


class ScanRequest(BaseModel):
    symbols: List[str]
    timeframe: str = "1M"
    count: int = 450
    settings: Optional[Dict[str, Any]] = None


def dict_to_settings(raw: Optional[Dict[str, Any]]) -> ScalpFusionSettings:
    if not raw:
        return ScalpFusionSettings()
    valid_fields = {k: v for k, v in raw.items() if hasattr(ScalpFusionSettings, k)}
    return ScalpFusionSettings(**valid_fields)


@app.get("/api/health")
def health():
    if mt5 is None:
        return {"ok": False, "mt5Connected": False, "error": "Package MetaTrader5 absent"}
    ok = mt5.initialize()
    if not ok:
        return {"ok": False, "mt5Connected": False, "error": str(mt5.last_error())}
    acc = mt5.account_info()
    term = mt5.terminal_info()
    return {
        "ok": True,
        "mt5Connected": True,
        "broker": acc.company if acc else "Exness",
        "server": acc.server if acc else "",
        "login": acc.login if acc else None,
        "balance": acc.balance if acc else None,
        "currency": acc.currency if acc else "USD",
        "terminal": term.name if term else "MetaTrader 5",
        "timeframes": list(TIMEFRAME_SECONDS.keys()),
    }


@app.get("/api/symbols")
def list_symbols(search: str = Query("", max_length=32), marketWatchOnly: bool = True):
    ensure_mt5()
    syms = mt5.symbols_get()
    if not syms:
        return {"symbols": []}
    q = search.strip().upper()
    out = []
    for s in syms:
        if marketWatchOnly and not s.visible and not q:
            continue
        if q and q not in s.name.upper() and q not in (s.description or "").upper():
            continue
        out.append(
            {
                "name": s.name,
                "description": s.description,
                "digits": s.digits,
                "visible": bool(s.visible),
                "path": s.path,
            }
        )
        if len(out) >= 120:
            break
    return {"symbols": out}


@app.get("/api/candles")
def get_candles(
    symbol: str = Query(...),
    timeframe: str = Query("1M"),
    count: int = Query(450, ge=100, le=1200),
):
    data = fetch_mt5_candles(symbol, timeframe, count)
    return {
        "symbol": data["symbol"],
        "requestedSymbol": symbol,
        "timeframe": timeframe,
        "source": "MT5 Exness Local",
        "candles": data["candles"],
    }


@app.post("/api/scan")
def scan_pairs(req: ScanRequest):
    settings = dict_to_settings(req.settings)
    results = []
    for sym in req.symbols:
        try:
            data = fetch_mt5_candles(sym, req.timeframe, req.count)
            computed = compute_scalp_fusion(data["candles"], req.timeframe, settings)
            results.append(
                {
                    "requestedSymbol": sym,
                    "resolvedSymbol": data["symbol"],
                    "ok": True,
                    "source": "MT5 Exness Local",
                    "timeframe": req.timeframe,
                    "effectiveParams": computed["effectiveParams"],
                    "summary": computed["summary"],
                    "breakoutLevels": computed["breakoutLevels"],
                    "candles": data["candles"],
                }
            )
        except HTTPException as exc:
            results.append(
                {
                    "requestedSymbol": sym,
                    "resolvedSymbol": sym,
                    "ok": False,
                    "error": exc.detail,
                    "timeframe": req.timeframe,
                }
            )
        except Exception as exc:  # pragma: no cover
            results.append(
                {
                    "requestedSymbol": sym,
                    "resolvedSymbol": sym,
                    "ok": False,
                    "error": str(exc),
                    "timeframe": req.timeframe,
                }
            )
    return {"results": results, "timestamp": int(time.time())}


# Si le build frontend (dossier dist/) est présent à côté de mt5_server.py, le servir directement
DIST_DIR = Path(__file__).resolve().parent / "dist"
if not DIST_DIR.exists():
    DIST_DIR = Path(__file__).resolve().parent.parent / "dist"

if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = DIST_DIR / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(DIST_DIR / "index.html"))

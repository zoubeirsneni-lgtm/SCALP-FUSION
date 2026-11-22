"""
SCALP FUSION v1.1 — Serveur & Pont Local MetaTrader 5 (Exness)
Serveur FastAPI local qui sert :
  1. Le tableau de bord complet (si le dossier dist/ est présent à côté)
  2. Le pont temps réel MetaTrader 5 Exness sur Windows :
     - Timeframes natifs : 1M, 3M, 5M, 10M, 15M
     - Timeframe 30s : agrégation temps réel des ticks MT5 (copy_ticks_range)
     - Résolution automatique des suffixes Exness (EURUSDm, EURUSDc, .r, etc.)
     - Calcul complet SCALP FUSION v1.1 + scan multi-paires
  3. Un fallback flux public (Binance / Yahoo CME Futures) si MT5 est fermé

Lancement :
  python -m uvicorn mt5_server:app --host 127.0.0.1 --port 8765
  ou : python mt5_server.py
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from contextlib import asynccontextmanager
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

DIST_DIR = Path(__file__).resolve().parent / "dist"
if not DIST_DIR.exists():
    DIST_DIR = Path(__file__).resolve().parent.parent / "dist"

HAS_DIST = DIST_DIR.exists() and (DIST_DIR / "index.html").exists()

_PUBLIC_CACHE: Dict[str, Dict[str, Any]] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if HAS_DIST and os.environ.get("SCALP_NO_BROWSER") != "1":
        port = os.environ.get("PORT", "8765")
        threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    yield


app = FastAPI(
    title="SCALP FUSION MT5 Exness Local",
    version="1.1.0",
    lifespan=lifespan,
)

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
            detail="Le package Python 'MetaTrader5' n'est pas installé (Windows 64-bit requis). Exécutez: pip install -r requirements.txt",
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
        hours_needed = max(5, int((count * 30) / 3600) + 1)
        last_tick = mt5.symbol_info_tick(resolved)
        anchor_utc = now_utc
        if last_tick is not None and getattr(last_tick, "time", 0) > 0:
            tick_dt = datetime.fromtimestamp(int(last_tick.time), tz=timezone.utc)
            if tick_dt < now_utc - timedelta(minutes=15) or tick_dt > now_utc:
                anchor_utc = tick_dt

        ticks = None
        for lookback_h in (hours_needed, 24, 96):
            t_from = anchor_utc - timedelta(hours=lookback_h)
            t_to = max(now_utc, anchor_utc) + timedelta(minutes=10)
            cand_ticks = mt5.copy_ticks_range(resolved, t_from, t_to, mt5.COPY_TICKS_ALL)
            if cand_ticks is not None and len(cand_ticks) > 0:
                ticks = cand_ticks
                break

        if ticks is not None and len(ticks) > 350_000:
            ticks = ticks[-350_000:]

        candles = aggregate_ticks_to_30s(ticks, max_bars=count)
        if not candles:
            raise HTTPException(
                status_code=404,
                detail=f"Aucun tick 30s récent trouvé dans MT5 pour {resolved} (marché fermé ou historique ticks vide).",
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


def _strip_exness_suffix(symbol: str) -> str:
    clean = symbol.strip().upper()
    for sfx in (".R", "_M", "M", "C"):
        if clean.endswith(sfx) and len(clean) > len(sfx) + 3:
            return clean[: -len(sfx)]
    return clean


def _resample_candles(bars: List[Dict[str, Any]], target_sec: int) -> List[Dict[str, Any]]:
    if not bars:
        return []
    buckets: Dict[int, Dict[str, Any]] = {}
    for b in bars:
        bt = int(b["time"]) - (int(b["time"]) % target_sec)
        ex = buckets.get(bt)
        if ex is None:
            buckets[bt] = {
                "time": bt,
                "open": b["open"],
                "high": b["high"],
                "low": b["low"],
                "close": b["close"],
                "volume": b["volume"],
                "isForming": bool(b.get("isForming", False)),
            }
        else:
            ex["high"] = max(ex["high"], b["high"])
            ex["low"] = min(ex["low"], b["low"])
            ex["close"] = b["close"]
            ex["volume"] += b["volume"]
            ex["isForming"] = bool(ex["isForming"] or b.get("isForming", False))
    return [buckets[k] for k in sorted(buckets.keys())]


def _fetch_json_url(url: str, headers: Optional[Dict[str, str]] = None) -> Any:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def _fetch_public_candles(symbol: str, timeframe: str, count: int) -> Dict[str, Any]:
    base = _strip_exness_suffix(symbol)
    crypto_map = {
        "BTCUSD": "BTCUSDT",
        "ETHUSD": "ETHUSDT",
        "SOLUSD": "SOLUSDT",
        "XRPUSD": "XRPUSDT",
        "BNBUSD": "BNBUSDT",
        "ADAUSD": "ADAUSDT",
        "DOGEUSD": "DOGEUSDT",
        "LTCUSD": "LTCUSDT",
    }
    binance_sym = crypto_map.get(base) or (base if base.endswith("USDT") else None)

    if binance_sym:
        if timeframe == "30s":
            url = f"https://api.binance.com/api/v3/aggTrades?symbol={urllib.parse.quote(binance_sym)}&limit=1000"
            trades = _fetch_json_url(url)
            buckets: Dict[int, Dict[str, Any]] = {}
            for t in trades:
                ts_sec = int(t["T"]) // 1000
                bt = ts_sec - (ts_sec % 30)
                p = float(t["p"])
                q = float(t["q"])
                ex = buckets.get(bt)
                if ex is None:
                    buckets[bt] = {"time": bt, "open": p, "high": p, "low": p, "close": p, "volume": q}
                else:
                    ex["high"] = max(ex["high"], p)
                    ex["low"] = min(ex["low"], p)
                    ex["close"] = p
                    ex["volume"] += q
            now_b = int(time.time())
            cur_b = now_b - (now_b % 30)
            bars = [
                {**buckets[k], "isForming": k >= cur_b}
                for k in sorted(buckets.keys())[-count:]
            ]
            return {"resolvedSymbol": binance_sym, "source": f"Binance Trades 30s ({binance_sym})", "candles": bars}

        tf_map = {
            "1M": ("1m", None, min(1000, count)),
            "3M": ("3m", None, min(1000, count)),
            "5M": ("5m", None, min(1000, count)),
            "10M": ("5m", 600, min(1000, count * 2)),
            "15M": ("15m", None, min(1000, count)),
        }
        interval, resamp, limit = tf_map.get(timeframe, ("1m", None, min(1000, count)))
        url = f"https://api.binance.com/api/v3/klines?symbol={urllib.parse.quote(binance_sym)}&interval={interval}&limit={limit}"
        raw = _fetch_json_url(url)
        now_ms = int(time.time() * 1000)
        bars = [
            {
                "time": int(k[0]) // 1000,
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
                "isForming": now_ms < int(k[6]),
            }
            for k in raw
        ]
        if resamp:
            bars = _resample_candles(bars, resamp)[-count:]
        return {"resolvedSymbol": binance_sym, "source": f"Binance Spot ({binance_sym})", "candles": bars}

    if timeframe == "30s":
        raise ValueError("Le flux 30s Forex/Métaux nécessite le terminal MT5 Exness ouvert.")

    yahoo_map = {
        "EURUSD": ("6E=F", False),
        "GBPUSD": ("6B=F", False),
        "AUDUSD": ("6A=F", False),
        "NZDUSD": ("6N=F", False),
        "USDJPY": ("6J=F", True),
        "USDCAD": ("6C=F", True),
        "USDCHF": ("6S=F", True),
        "XAUUSD": ("GC=F", False),
        "XAGUSD": ("SI=F", False),
        "USOIL": ("CL=F", False),
        "UKOIL": ("BZ=F", False),
        "US30": ("YM=F", False),
        "USTEC": ("NQ=F", False),
        "NAS100": ("NQ=F", False),
        "US500": ("ES=F", False),
        "SPX500": ("ES=F", False),
        "DE40": ("^GDAXI", False),
        "GER40": ("^GDAXI", False),
        "UK100": ("^FTSE", False),
        "DXY": ("DX-Y.NYB", False),
    }
    if base in yahoo_map:
        ticker, invert = yahoo_map[base]
    elif re.match(r"^[A-Z]{6}$", base):
        ticker, invert = f"{base}=X", False
    else:
        ticker, invert = base, False

    y_cfg = {
        "1M": ("1m", "5d", 60),
        "3M": ("1m", "5d", 180),
        "5M": ("5m", "5d", 300),
        "10M": ("5m", "5d", 600),
        "15M": ("15m", "5d", 900),
    }
    interval, rng, resamp = y_cfg.get(timeframe, ("1m", "5d", 60))
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?interval={interval}&range={rng}"
    data = _fetch_json_url(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json",
        },
    )
    res_list = data.get("chart", {}).get("result") or []
    if not res_list:
        raise ValueError(f"Aucune donnée publique pour {ticker}")
    res0 = res_list[0]
    ts = res0.get("timestamp") or []
    q = (res0.get("indicators", {}).get("quote") or [{}])[0]
    opens, highs, lows, closes, vols = (
        q.get("open") or [],
        q.get("high") or [],
        q.get("low") or [],
        q.get("close") or [],
        q.get("volume") or [],
    )
    now_sec = int(time.time())
    bars: List[Dict[str, Any]] = []
    for i, t in enumerate(ts):
        ro, rh, rl, rc = opens[i], highs[i], lows[i], closes[i]
        if ro is None or rh is None or rl is None or rc is None:
            continue
        if ro <= 0 or rh <= 0 or rl <= 0 or rc <= 0:
            continue
        o = (1.0 / ro) if invert else float(ro)
        c = (1.0 / rc) if invert else float(rc)
        h = (1.0 / rl) if invert else float(rh)
        l = (1.0 / rh) if invert else float(rl)
        v = float(vols[i]) if i < len(vols) and vols[i] and vols[i] > 0 else 1.0
        bars.append(
            {
                "time": int(t),
                "open": o,
                "high": max(h, o, c),
                "low": min(l, o, c),
                "close": c,
                "volume": v,
                "isForming": now_sec < int(t) + resamp,
            }
        )
    bars = _resample_candles(bars, resamp)[-count:]
    return {"resolvedSymbol": ticker, "source": f"Flux Public ({ticker})", "candles": bars}


class ScanRequest(BaseModel):
    symbols: List[str]
    timeframe: str = "1M"
    count: int = 450
    settings: Optional[Dict[str, Any]] = None
    includeComputed: bool = True


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


@app.get("/api/market/candles")
def get_public_candles(
    symbol: str = Query("EURUSDm"),
    timeframe: str = Query("1M"),
    count: int = Query(450, ge=100, le=1000),
):
    cache_key = f"{symbol.upper()}_{timeframe}_{count}"
    cached = _PUBLIC_CACHE.get(cache_key)
    if cached and cached["expiresAt"] > time.time():
        return {
            "ok": True,
            "symbol": symbol,
            "resolvedSymbol": cached["resolvedSymbol"],
            "timeframe": timeframe,
            "source": cached["source"],
            "candles": cached["candles"],
        }
    try:
        data = _fetch_public_candles(symbol, timeframe, count)
        _PUBLIC_CACHE[cache_key] = {
            "expiresAt": time.time() + 12,
            "resolvedSymbol": data["resolvedSymbol"],
            "source": data["source"],
            "candles": data["candles"],
        }
        return {
            "ok": True,
            "symbol": symbol,
            "resolvedSymbol": data["resolvedSymbol"],
            "timeframe": timeframe,
            "source": data["source"],
            "candles": data["candles"],
        }
    except Exception as exc:
        return JSONResponse(
            status_code=502,
            content={"ok": False, "symbol": symbol, "timeframe": timeframe, "error": str(exc)},
        )


@app.post("/api/scan")
def scan_pairs(req: ScanRequest):
    settings = dict_to_settings(req.settings) if req.includeComputed else None
    results = []
    for sym in req.symbols:
        try:
            data = fetch_mt5_candles(sym, req.timeframe, req.count)
            item: Dict[str, Any] = {
                "requestedSymbol": sym,
                "resolvedSymbol": data["symbol"],
                "ok": True,
                "source": "MT5 Exness Local",
                "timeframe": req.timeframe,
                "candles": data["candles"],
            }
            if req.includeComputed and settings is not None:
                computed = compute_scalp_fusion(data["candles"], req.timeframe, settings)
                item["effectiveParams"] = computed["effectiveParams"]
                item["summary"] = computed["summary"]
                item["breakoutLevels"] = computed["breakoutLevels"]
            results.append(item)
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


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE"])
def api_not_found(rest: str):
    return JSONResponse(status_code=404, content={"ok": False, "error": f"Route /api/{rest} introuvable"})


if HAS_DIST:
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = DIST_DIR / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(DIST_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8765"))
    uvicorn.run("mt5_server:app", host="127.0.0.1", port=port, reload=False)

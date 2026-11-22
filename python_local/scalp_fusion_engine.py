"""
SCALP FUSION v1.1 — Moteur de calcul Python exact (Pine Script v6)
Traduction fidèle de :
  - UT Bot Alerts (QuantNomad)
  - SCALPTOOL R1.1 (JustUncleL)
  - Humble LinReg Candles (ugurvu)
  - S/R Levels with Breaks + Veto (LuxAlgo)
  - Breakout Probability (Zeiierman)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional


TIMEFRAME_SECONDS: Dict[str, int] = {
    "30s": 30,
    "1M": 60,
    "3M": 180,
    "5M": 300,
    "10M": 600,
    "15M": 900,
}


@dataclass
class ScalpFusionSettings:
    # 1. Général
    profile: str = "Auto (Timeframe)"  # "Auto (Timeframe)", "M1", "M3/M5", "Custom"
    useHA: bool = False
    signalOnClose: bool = True

    # 2. UT Bot
    kvManual: float = 1.2
    atrManual: int = 11
    showTrail: bool = True
    showUTRaw: bool = False

    # 3. SCALPTOOL
    pacManual: int = 13
    fastManual: int = 34
    medManual: int = 89
    slowManual: int = 233
    lbManual: int = 2
    showFastEMA: bool = True
    showMedEMA: bool = True
    showSlowEMA: bool = False
    showPAC: bool = True
    showFract: bool = False
    filterBW: bool = False
    showHHLL: bool = False
    showScArrow: bool = False
    delayArrow: bool = True
    showTrendBG: bool = True

    # 4. LRC
    lrManual: int = 14
    sigManual: int = 9
    smaSignal: bool = True
    useLinReg: bool = True
    showLRC: bool = True
    showSigLine: bool = True

    # 5. Support / Résistance
    srLManual: int = 10
    srRManual: int = 10
    useVolFilt: bool = False
    volThresh: float = 20.0
    showSR: bool = True
    showBreaks: bool = True
    useSRVeto: bool = True
    vetoK: float = 1.0

    # 6. Signal final
    confMode: str = "Souple (≥1 filtre)"  # "Souple (≥1 filtre)", "Stricte (2 filtres)", "UT Bot seul"

    # 7. Breakout Probability
    boPercManual: float = 0.01
    boNbr: int = 3
    boFillOn: bool = False
    boHide0: bool = True
    boShowPanel: bool = False
    useBoFilter: bool = False

    # 8. Schaff Trend Cycle (STC)
    showSTC: bool = True
    stcLength: int = 12
    stcFastLength: int = 26
    stcSlowLength: int = 50
    stcFactor: float = 0.5
    showSTCAlerts: bool = True


def _sma(values: List[float], length: int) -> List[Optional[float]]:
    n = len(values)
    out: List[Optional[float]] = [None] * n
    if length <= 0:
        return out
    running = 0.0
    for i in range(n):
        running += values[i]
        if i >= length:
            running -= values[i - length]
        if i >= length - 1:
            out[i] = running / length
    return out


def _sma_opt(values: List[Optional[float]], length: int) -> List[Optional[float]]:
    n = len(values)
    out: List[Optional[float]] = [None] * n
    if length <= 0:
        return out
    for i in range(length - 1, n):
        window = values[i - length + 1 : i + 1]
        if any(v is None for v in window):
            out[i] = None
        else:
            out[i] = sum(v for v in window if v is not None) / length
    return out


def _ema(values: List[float], length: int) -> List[float]:
    n = len(values)
    if n == 0:
        return []
    if length <= 1:
        return list(values)
    alpha = 2.0 / (length + 1.0)
    out = [0.0] * n
    out[0] = values[0]
    for i in range(1, n):
        out[i] = alpha * values[i] + (1.0 - alpha) * out[i - 1]
    return out


def _ema_opt(values: List[Optional[float]], length: int) -> List[Optional[float]]:
    n = len(values)
    out: List[Optional[float]] = [None] * n
    if length <= 1:
        return list(values)
    alpha = 2.0 / (length + 1.0)
    prev: Optional[float] = None
    for i in range(n):
        v = values[i]
        if v is None:
            out[i] = prev
            continue
        if prev is None:
            prev = v
        else:
            prev = alpha * v + (1.0 - alpha) * prev
        out[i] = prev
    return out


def _rma(values: List[float], length: int) -> List[Optional[float]]:
    """Wilder's Moving Average (ta.rma / ta.atr in Pine Script)."""
    n = len(values)
    out: List[Optional[float]] = [None] * n
    if n == 0 or length <= 0:
        return out
    alpha = 1.0 / length
    acc = 0.0
    for i in range(n):
        if i < length - 1:
            acc += values[i]
        elif i == length - 1:
            acc += values[i]
            out[i] = acc / length
        else:
            prev = out[i - 1]
            assert prev is not None
            out[i] = alpha * values[i] + (1.0 - alpha) * prev
    return out


def _linreg(values: List[float], length: int, offset: int = 0) -> List[Optional[float]]:
    """Pine ta.linreg(source, length, offset)."""
    n = len(values)
    out: List[Optional[float]] = [None] * n
    if length <= 1:
        return [float(v) for v in values]

    sum_x = length * (length - 1) / 2.0
    sum_x2 = (length - 1) * length * (2 * length - 1) / 6.0
    denom = length * sum_x2 - sum_x * sum_x

    for i in range(length - 1, n):
        start = i - length + 1
        sum_y = 0.0
        sum_xy = 0.0
        for j in range(length):
            y = values[start + j]
            sum_y += y
            sum_xy += j * y
        slope = (length * sum_xy - sum_x * sum_y) / denom if denom != 0 else 0.0
        intercept = (sum_y - slope * sum_x) / length
        out[i] = intercept + slope * (length - 1 - offset)
    return out


def resolve_effective_params(settings: ScalpFusionSettings, tf_seconds: int) -> Dict[str, Any]:
    is_m1 = settings.profile == "M1" or (
        settings.profile == "Auto (Timeframe)" and tf_seconds <= 60
    )
    is_cust = settings.profile == "Custom"
    return {
        "isM1": is_m1,
        "profileLabel": "Custom" if is_cust else ("M1" if is_m1 else "M3/M5"),
        "kvEff": settings.kvManual if is_cust else (1.2 if is_m1 else 1.5),
        "atrEff": settings.atrManual if is_cust else 11,
        "pacLen": settings.pacManual if is_cust else (13 if is_m1 else 21),
        "fastLen": settings.fastManual if is_cust else (34 if is_m1 else 55),
        "medLen": settings.medManual if is_cust else (89 if is_m1 else 144),
        "slowLen": settings.slowManual if is_cust else (233 if is_m1 else 377),
        "lbEff": settings.lbManual if is_cust else (2 if is_m1 else 3),
        "lrLen": settings.lrManual if is_cust else (14 if is_m1 else 18),
        "sigLen": settings.sigManual if is_cust else (9 if is_m1 else 11),
        "srL": settings.srLManual if is_cust else (10 if is_m1 else 15),
        "srR": settings.srRManual if is_cust else (10 if is_m1 else 15),
        "boPerc": settings.boPercManual if is_cust else (0.01 if is_m1 else 0.03),
    }


def compute_scalp_fusion(
    candles: List[Dict[str, Any]],
    timeframe: str,
    settings: Optional[ScalpFusionSettings] = None,
) -> Dict[str, Any]:
    if settings is None:
        settings = ScalpFusionSettings()

    n = len(candles)
    tf_seconds = TIMEFRAME_SECONDS.get(timeframe, 60)
    eff = resolve_effective_params(settings, tf_seconds)

    if n == 0:
        return {
            "effectiveParams": eff,
            "bars": [],
            "breakoutLevels": None,
            "summary": None,
        }

    opens = [float(c["open"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]
    closes = [float(c["close"]) for c in candles]
    volumes = [float(c.get("volume", 1.0)) for c in candles]

    # Common source (normal or Heikin Ashi)
    if settings.useHA:
        src_o = [0.0] * n
        src_h = [0.0] * n
        src_l = [0.0] * n
        src_c = [0.0] * n
        for i in range(n):
            ha_c = (opens[i] + highs[i] + lows[i] + closes[i]) / 4.0
            ha_o = (opens[0] + closes[0]) / 2.0 if i == 0 else (src_o[i - 1] + src_c[i - 1]) / 2.0
            src_c[i] = ha_c
            src_o[i] = ha_o
            src_h[i] = max(highs[i], ha_o, ha_c)
            src_l[i] = min(lows[i], ha_o, ha_c)
    else:
        src_o = opens
        src_h = highs
        src_l = lows
        src_c = closes

    # ── 2. UT BOT ────────────────────────────────────────────────────────────
    tr = [0.0] * n
    for i in range(n):
        if i == 0:
            tr[i] = src_h[i] - src_l[i]
        else:
            tr[i] = max(
                src_h[i] - src_l[i],
                abs(src_h[i] - src_c[i - 1]),
                abs(src_l[i] - src_c[i - 1]),
            )

    x_atr_raw = _rma(tr, eff["atrEff"])
    x_atr = [v if v is not None else tr[i] for i, v in enumerate(x_atr_raw)]

    x_atr_stop = [0.0] * n
    ut_pos = [0] * n
    ut_buy = [False] * n
    ut_sell = [False] * n
    ut_ema = _ema(src_c, 1)  # alpha=1 => identical to src_c

    for i in range(n):
        n_loss = eff["kvEff"] * x_atr[i]
        prev_stop = x_atr_stop[i - 1] if i > 0 else 0.0
        prev_c = src_c[i - 1] if i > 0 else src_c[i]
        curr_c = src_c[i]

        if curr_c > prev_stop and prev_c > prev_stop:
            stop = max(prev_stop, curr_c - n_loss)
        elif curr_c < prev_stop and prev_c < prev_stop:
            stop = min(prev_stop, curr_c + n_loss)
        elif curr_c > prev_stop:
            stop = curr_c - n_loss
        else:
            stop = curr_c + n_loss
        x_atr_stop[i] = stop

        prev_pos = ut_pos[i - 1] if i > 0 else 0
        if i > 0 and prev_c < prev_stop and curr_c > prev_stop:
            ut_pos[i] = 1
        elif i > 0 and prev_c > prev_stop and curr_c < prev_stop:
            ut_pos[i] = -1
        else:
            ut_pos[i] = prev_pos

        if i > 0:
            prev_ema = ut_ema[i - 1]
            curr_ema = ut_ema[i]
            ut_above = prev_ema <= prev_stop and curr_ema > stop
            ut_below = prev_stop <= prev_ema and stop > curr_ema
            ut_buy[i] = curr_c > stop and ut_above
            ut_sell[i] = curr_c < stop and ut_below

    # ── 3. SCALPTOOL ─────────────────────────────────────────────────────────
    fast_ema = _ema(src_c, eff["fastLen"])
    med_ema = _ema(src_c, eff["medLen"])
    slow_ema = _ema(src_c, eff["slowLen"])
    pac_c = _ema(src_c, eff["pacLen"])
    pac_l = _ema(src_l, eff["pacLen"])
    pac_u = _ema(src_h, eff["pacLen"])

    trend_dir = [0] * n
    filtered_top_f = [False] * n
    filtered_bot_f = [False] * n
    higher_high = [False] * n
    lower_high = [False] * n
    higher_low = [False] * n
    lower_low = [False] * n
    sc_buy = [False] * n
    sc_sell = [False] * n
    trade_dir = [0] * n

    vh_hist: List[float] = []
    vl_hist: List[float] = []
    bars_below_c: Optional[int] = None
    bars_above_c: Optional[int] = None

    for i in range(n):
        if fast_ema[i] > med_ema[i] and pac_l[i] > med_ema[i]:
            trend_dir[i] = 1
        elif fast_ema[i] < med_ema[i] and pac_u[i] < med_ema[i]:
            trend_dir[i] = -1
        else:
            trend_dir[i] = 0

        if i >= 4:
            if settings.filterBW:
                top_f = (
                    highs[i - 4] < highs[i - 3]
                    and highs[i - 3] < highs[i - 2]
                    and highs[i - 2] > highs[i - 1]
                    and highs[i - 1] > highs[i]
                )
                bot_f = (
                    lows[i - 4] > lows[i - 3]
                    and lows[i - 3] > lows[i - 2]
                    and lows[i - 2] < lows[i - 1]
                    and lows[i - 1] < lows[i]
                )
            else:
                top_f = (
                    highs[i - 4] < highs[i - 2]
                    and highs[i - 3] <= highs[i - 2]
                    and highs[i - 2] >= highs[i - 1]
                    and highs[i - 2] > highs[i]
                )
                bot_f = (
                    lows[i - 4] > lows[i - 2]
                    and lows[i - 3] >= lows[i - 2]
                    and lows[i - 2] <= lows[i - 1]
                    and lows[i - 2] < lows[i]
                )
            filtered_top_f[i] = top_f
            filtered_bot_f[i] = bot_f

            if top_f:
                vh_hist.insert(0, highs[i - 2])
                if len(vh_hist) >= 3:
                    higher_high[i] = vh_hist[1] < vh_hist[0] and vh_hist[2] < vh_hist[0]
                    lower_high[i] = vh_hist[1] > vh_hist[0] and vh_hist[2] > vh_hist[0]
            if bot_f:
                vl_hist.insert(0, lows[i - 2])
                if len(vl_hist) >= 3:
                    higher_low[i] = vl_hist[1] < vl_hist[0] and vl_hist[2] < vl_hist[0]
                    lower_low[i] = vl_hist[1] > vl_hist[0] and vl_hist[2] > vl_hist[0]

        if src_c[i] < pac_c[i]:
            bars_below_c = 0
        elif bars_below_c is not None:
            bars_below_c += 1

        if src_c[i] > pac_c[i]:
            bars_above_c = 0
        elif bars_above_c is not None:
            bars_above_c += 1

        lb_below = bars_below_c if bars_below_c is not None else eff["lbEff"] + 1
        lb_above = bars_above_c if bars_above_c is not None else eff["lbEff"] + 1
        pac_exit_u = src_o[i] < pac_u[i] and src_c[i] > pac_u[i] and lb_below <= eff["lbEff"]
        pac_exit_l = src_o[i] > pac_l[i] and src_c[i] < pac_l[i] and lb_above <= eff["lbEff"]

        sc_buy[i] = trend_dir[i] == 1 and pac_exit_u
        sc_sell[i] = trend_dir[i] == -1 and pac_exit_l

        prev_td = trade_dir[i - 1] if i > 0 else 0
        if prev_td == 1 and src_c[i] < pac_c[i]:
            trade_dir[i] = 0
        elif prev_td == -1 and src_c[i] > pac_c[i]:
            trade_dir[i] = 0
        elif prev_td == 0 and sc_buy[i]:
            trade_dir[i] = 1
        elif prev_td == 0 and sc_sell[i]:
            trade_dir[i] = -1
        else:
            trade_dir[i] = prev_td

    # ── 4. LRC ───────────────────────────────────────────────────────────────
    if settings.useLinReg:
        lr_o = _linreg(src_o, eff["lrLen"], 0)
        lr_h = _linreg(src_h, eff["lrLen"], 0)
        lr_l = _linreg(src_l, eff["lrLen"], 0)
        lr_c = _linreg(src_c, eff["lrLen"], 0)
        b_open = [lr_o[i] if lr_o[i] is not None else src_o[i] for i in range(n)]
        b_high = [lr_h[i] if lr_h[i] is not None else src_h[i] for i in range(n)]
        b_low = [lr_l[i] if lr_l[i] is not None else src_l[i] for i in range(n)]
        b_close = [lr_c[i] if lr_c[i] is not None else src_c[i] for i in range(n)]
        lrc_sig_raw = (
            _sma_opt(lr_c, eff["sigLen"])
            if settings.smaSignal
            else _ema_opt(lr_c, eff["sigLen"])
        )
    else:
        b_open = list(src_o)
        b_high = list(src_h)
        b_low = list(src_l)
        b_close = list(src_c)
        lrc_sig_raw = (
            _sma(src_c, eff["sigLen"])
            if settings.smaSignal
            else [float(v) for v in _ema(src_c, eff["sigLen"])]
        )

    lrc_bull = [b_open[i] < b_close[i] for i in range(n)]

    # ── 5. S/R & VETO ────────────────────────────────────────────────────────
    sr_l = eff["srL"]
    sr_r = eff["srR"]
    piv_high: List[Optional[float]] = [None] * n
    piv_low: List[Optional[float]] = [None] * n

    for i in range(sr_l + sr_r, n):
        cand_idx = i - sr_r
        cand_h = highs[cand_idx]
        cand_l = lows[cand_idx]

        is_ph = all(highs[j] < cand_h for j in range(cand_idx - sr_l, cand_idx)) and all(
            highs[j] <= cand_h for j in range(cand_idx + 1, i + 1)
        )
        is_pl = all(lows[j] > cand_l for j in range(cand_idx - sr_l, cand_idx)) and all(
            lows[j] >= cand_l for j in range(cand_idx + 1, i + 1)
        )
        if is_ph:
            piv_high[i] = cand_h
        if is_pl:
            piv_low[i] = cand_l

    high_use_pivot: List[Optional[float]] = [None] * n
    low_use_pivot: List[Optional[float]] = [None] * n
    last_ph: Optional[float] = None
    last_pl: Optional[float] = None
    for i in range(n):
        if i > 0:
            if piv_high[i - 1] is not None:
                last_ph = piv_high[i - 1]
            if piv_low[i - 1] is not None:
                last_pl = piv_low[i - 1]
        high_use_pivot[i] = last_ph
        low_use_pivot[i] = last_pl

    vol_short_e = _ema(volumes, 5)
    vol_long_e = _ema(volumes, 10)
    res_broken = [False] * n
    sup_broken = [False] * n
    break_up = [False] * n
    break_dn = [False] * n
    bull_wick = [False] * n
    bear_wick = [False] * n
    res_too_close = [False] * n
    sup_too_close = [False] * n

    for i in range(n):
        v_long = vol_long_e[i]
        vol_osc = 100.0 * (vol_short_e[i] - v_long) / v_long if v_long != 0 else 0.0
        vol_ok = (not settings.useVolFilt) or (vol_osc > settings.volThresh)

        ph_curr = high_use_pivot[i]
        pl_curr = low_use_pivot[i]
        if i > 0:
            ph_prev = high_use_pivot[i - 1]
            pl_prev = low_use_pivot[i - 1]
            if ph_curr is not None and ph_prev is not None:
                cross_res = closes[i - 1] <= ph_prev and closes[i] > ph_curr
                res_broken[i] = cross_res and vol_ok
                if cross_res:
                    wick_cond = (opens[i] - lows[i]) > (closes[i] - opens[i])
                    break_up[i] = res_broken[i] and not wick_cond
                    bull_wick[i] = wick_cond
            if pl_curr is not None and pl_prev is not None:
                cross_sup = closes[i - 1] >= pl_prev and closes[i] < pl_curr
                sup_broken[i] = cross_sup and vol_ok
                if cross_sup:
                    wick_cond = (opens[i] - closes[i]) < (highs[i] - opens[i])
                    break_dn[i] = sup_broken[i] and not wick_cond
                    bear_wick[i] = wick_cond

        veto_dist = settings.vetoK * x_atr[i]
        if settings.useSRVeto and ph_curr is not None and ph_curr > closes[i]:
            res_too_close[i] = (ph_curr - closes[i]) < veto_dist
        if settings.useSRVeto and pl_curr is not None and pl_curr < closes[i]:
            sup_too_close[i] = (closes[i] - pl_curr) < veto_dist

    # ── 7. BREAKOUT PROBABILITY ──────────────────────────────────────────────
    bo_total_g = 0
    bo_total_r = 0
    bo_counts = [[0, 0, 0, 0] for _ in range(5)]
    bo_vals = [[0.0, 0.0, 0.0, 0.0] for _ in range(5)]
    bo_win = 0
    bo_loss = 0
    bo_bull_bias = [True] * n

    for i in range(1, n):
        bo_green = closes[i - 1] > opens[i - 1]
        bo_red = closes[i - 1] < opens[i - 1]
        bo_step = closes[i] * (eff["boPerc"] / 100.0)

        if bo_green:
            bo_total_g += 1
        if bo_red:
            bo_total_r += 1

        for k in range(5):
            x = bo_step * k
            hh = highs[i] >= highs[i - 1] + x
            ll = lows[i] <= lows[i - 1] - x
            if bo_green and hh and bo_total_g > 0:
                bo_counts[k][0] += 1
                bo_vals[k][0] = round((bo_counts[k][0] / bo_total_g) * 100.0, 2)
            if bo_green and ll and bo_total_g > 0:
                bo_counts[k][1] += 1
                bo_vals[k][1] = round((bo_counts[k][1] / bo_total_g) * 100.0, 2)
            if bo_red and hh and bo_total_r > 0:
                bo_counts[k][2] += 1
                bo_vals[k][2] = round((bo_counts[k][2] / bo_total_r) * 100.0, 2)
            if bo_red and ll and bo_total_r > 0:
                bo_counts[k][3] += 1
                bo_vals[k][3] = round((bo_counts[k][3] / bo_total_r) * 100.0, 2)

        a1, b1 = bo_vals[0][0], bo_vals[0][1]
        a2, b2 = bo_vals[0][2], bo_vals[0][3]
        bo_bull_bias[i] = (max(a1, b1) == a1) if bo_green else (max(a2, b2) == a2)

        target_v = (highs[i - 1] if max(a1, b1) == a1 else lows[i - 1]) if bo_green else (
            highs[i - 1] if max(a2, b2) == a2 else lows[i - 1]
        )
        if target_v == highs[i - 1]:
            if highs[i] >= target_v:
                bo_win += 1
            else:
                bo_loss += 1
        else:
            if lows[i] <= target_v:
                bo_win += 1
            else:
                bo_loss += 1

    # ── 8. SCHAFF TREND CYCLE ([SHK] STC) ────────────────────────────────────
    stc_len = max(1, int(settings.stcLength or 12))
    stc_fast = max(1, int(settings.stcFastLength or 26))
    stc_slow = max(1, int(settings.stcSlowLength or 50))
    stc_alpha = settings.stcFactor if settings.stcFactor > 0 else 0.5

    stc_fast_ma = _ema(closes, stc_fast)
    stc_slow_ma = _ema(closes, stc_slow)
    stc_macd = [stc_fast_ma[i] - stc_slow_ma[i] for i in range(n)]

    stc_ddd = [0.0] * n
    stc_vals = [0.0] * n
    stc_bull = [False] * n
    stc_alert_red = [False] * n
    stc_alert_green = [False] * n

    stc_pf_prev = 0.0
    stc_pff_prev = 0.0

    for i in range(n):
        start_w = max(0, i - stc_len + 1)
        win_m = stc_macd[start_w : i + 1]
        min_m = min(win_m)
        range_m = max(win_m) - min_m
        pf = ((stc_macd[i] - min_m) / range_m) * 100.0 if range_m > 0 else stc_pf_prev
        stc_pf_prev = pf

        ddd = pf if i == 0 else stc_ddd[i - 1] + stc_alpha * (pf - stc_ddd[i - 1])
        stc_ddd[i] = ddd

        win_d = stc_ddd[start_w : i + 1]
        min_d = min(win_d)
        range_d = max(win_d) - min_d
        pff = ((ddd - min_d) / range_d) * 100.0 if range_d > 0 else stc_pff_prev
        stc_pff_prev = pff

        stc_val = pff if i == 0 else stc_vals[i - 1] + stc_alpha * (pff - stc_vals[i - 1])
        stc_vals[i] = stc_val
        stc_bull[i] = stc_val > stc_vals[i - 1] if i > 0 else False

        if i >= 3:
            stc_alert_red[i] = (
                stc_vals[i - 3] <= stc_vals[i - 2]
                and stc_vals[i - 2] > stc_vals[i - 1]
                and stc_val > 75.0
            )
            stc_alert_green[i] = (
                stc_vals[i - 3] >= stc_vals[i - 2]
                and stc_vals[i - 2] < stc_vals[i - 1]
                and stc_val < 25.0
            )

    # ── 6. SIGNAL FINAL ──────────────────────────────────────────────────────
    need_n = 2 if settings.confMode == "Stricte (2 filtres)" else 1
    no_filt = settings.confMode == "UT Bot seul"

    bars_out: List[Dict[str, Any]] = []
    last_final_signal: Optional[str] = None
    last_final_time: Optional[int] = None

    for i in range(n):
        buy_cnt = (1 if trend_dir[i] == 1 else 0) + (1 if lrc_bull[i] else 0)
        sell_cnt = (1 if trend_dir[i] == -1 else 0) + (1 if not lrc_bull[i] else 0)

        raw_buy = ut_buy[i] and (no_filt or buy_cnt >= need_n)
        raw_sell = ut_sell[i] and (no_filt or sell_cnt >= need_n)

        final_buy = (
            raw_buy
            and (not res_too_close[i])
            and ((not settings.useBoFilter) or bo_bull_bias[i])
        )
        final_sell = (
            raw_sell
            and (not sup_too_close[i])
            and ((not settings.useBoFilter) or (not bo_bull_bias[i]))
        )

        is_forming = bool(candles[i].get("isForming", False))
        confirmed = not is_forming
        final_buy_sig = final_buy and ((not settings.signalOnClose) or confirmed)
        final_sell_sig = final_sell and ((not settings.signalOnClose) or confirmed)

        veto_blocked: Optional[str] = None
        if raw_buy and res_too_close[i]:
            veto_blocked = "VETO_RES"
        elif raw_sell and sup_too_close[i]:
            veto_blocked = "VETO_SUP"

        if final_buy_sig:
            last_final_signal = "ACHAT"
            last_final_time = int(candles[i]["time"])
        elif final_sell_sig:
            last_final_signal = "VENTE"
            last_final_time = int(candles[i]["time"])

        bars_out.append(
            {
                "time": int(candles[i]["time"]),
                "open": opens[i],
                "high": highs[i],
                "low": lows[i],
                "close": closes[i],
                "volume": volumes[i],
                "isForming": is_forming,
                "srcOpen": src_o[i],
                "srcHigh": src_h[i],
                "srcLow": src_l[i],
                "srcClose": src_c[i],
                "atr": x_atr[i],
                "utStop": x_atr_stop[i],
                "utPos": ut_pos[i],
                "utBuy": ut_buy[i],
                "utSell": ut_sell[i],
                "fastEMA": fast_ema[i],
                "medEMA": med_ema[i],
                "slowEMA": slow_ema[i],
                "pacC": pac_c[i],
                "pacL": pac_l[i],
                "pacU": pac_u[i],
                "trendDir": trend_dir[i],
                "scBuy": sc_buy[i],
                "scSell": sc_sell[i],
                "tradeDir": trade_dir[i],
                "fracTop": filtered_top_f[i],
                "fracBot": filtered_bot_f[i],
                "hh": higher_high[i],
                "lh": lower_high[i],
                "hl": higher_low[i],
                "ll": lower_low[i],
                "bOpen": b_open[i],
                "bHigh": b_high[i],
                "bLow": b_low[i],
                "bClose": b_close[i],
                "lrcBull": lrc_bull[i],
                "lrcSignal": lrc_sig_raw[i],
                "srRes": high_use_pivot[i],
                "srSup": low_use_pivot[i],
                "resBroken": res_broken[i],
                "supBroken": sup_broken[i],
                "breakUp": break_up[i],
                "breakDn": break_dn[i],
                "bullWick": bull_wick[i],
                "bearWick": bear_wick[i],
                "resTooClose": res_too_close[i],
                "supTooClose": sup_too_close[i],
                "boBullBias": bo_bull_bias[i],
                "finalBuy": final_buy,
                "finalSell": final_sell,
                "finalBuySig": final_buy_sig,
                "finalSellSig": final_sell_sig,
                "vetoBlocked": veto_blocked,
                "stc": stc_vals[i],
                "stcBull": stc_bull[i],
                "stcAlertRed": stc_alert_red[i],
                "stcAlertGreen": stc_alert_green[i],
            }
        )

    # Current Breakout Probability levels for the last bar
    last = bars_out[-1]
    prev_bar = bars_out[-2] if n >= 2 else bars_out[-1]
    last_green = prev_bar["close"] > prev_bar["open"]
    step = last["close"] * (eff["boPerc"] / 100.0)
    up_levels = []
    dn_levels = []
    nbr = max(1, min(5, settings.boNbr))
    for k in range(nbr):
        p_up = bo_vals[k][0] if last_green else bo_vals[k][2]
        p_dn = bo_vals[k][1] if last_green else bo_vals[k][3]
        up_levels.append({"price": prev_bar["high"] + step * k, "prob": p_up})
        dn_levels.append({"price": prev_bar["low"] - step * k, "prob": p_dn})

    bo_wr = round((bo_win / (bo_win + bo_loss)) * 100.0, 2) if (bo_win + bo_loss) > 0 else 0.0
    breakout_info = {
        "upLevels": up_levels,
        "dnLevels": dn_levels,
        "upProb0": bo_vals[0][0] if last_green else bo_vals[0][2],
        "dnProb0": bo_vals[0][1] if last_green else bo_vals[0][3],
        "bullBias": last["boBullBias"],
        "win": bo_win,
        "loss": bo_loss,
        "winRate": bo_wr,
    }

    # Summary evaluation bar (latest confirmed bar if signalOnClose else latest bar)
    eval_bar = bars_out[-2] if (settings.signalOnClose and last["isForming"] and n >= 2) else last
    prev_close = bars_out[-2]["close"] if n >= 2 else last["open"]
    change_pct = ((last["close"] - prev_close) / prev_close * 100.0) if prev_close != 0 else 0.0

    signal_state = "ATTENTE"
    if eval_bar["finalBuySig"]:
        signal_state = "ACHAT"
    elif eval_bar["finalSellSig"]:
        signal_state = "VENTE"
    elif eval_bar["vetoBlocked"] is not None:
        signal_state = eval_bar["vetoBlocked"]

    summary = {
        "price": last["close"],
        "prevClose": prev_close,
        "changePct": change_pct,
        "barTime": last["time"],
        "evalBarTime": eval_bar["time"],
        "signalState": signal_state,
        "utPos": eval_bar["utPos"],
        "utStop": eval_bar["utStop"],
        "trendDir": eval_bar["trendDir"],
        "lrcBull": eval_bar["lrcBull"],
        "atr": eval_bar["atr"],
        "srRes": eval_bar["srRes"],
        "srSup": eval_bar["srSup"],
        "resTooClose": eval_bar["resTooClose"],
        "supTooClose": eval_bar["supTooClose"],
        "boBullBias": breakout_info["bullBias"],
        "boUpProb": breakout_info["upProb0"],
        "boDnProb": breakout_info["dnProb0"],
        "lastFinalSignal": last_final_signal,
        "lastFinalTime": last_final_time,
    }

    return {
        "effectiveParams": eff,
        "bars": bars_out,
        "breakoutLevels": breakout_info,
        "summary": summary,
    }


def aggregate_ticks_to_30s(ticks: Any, max_bars: int = 500) -> List[Dict[str, Any]]:
    """
    Agrège un tableau structuré de ticks MetaTrader 5 en bougies de 30 secondes.
    Utilise le prix Bid (standard MT5 pour les graphiques Forex), avec repli sur Last.
    Vectorisé avec NumPy pour traiter plusieurs centaines de milliers de ticks en < 5 ms.
    """
    if ticks is None or len(ticks) == 0:
        return []

    now_ts = int(time.time()) if "time" in globals() else int(__import__("time").time())
    current_bucket = now_ts - (now_ts % 30)

    try:
        import numpy as np  # type: ignore

        if isinstance(ticks, np.ndarray) and ticks.dtype.names:
            ts = ticks["time"].astype(np.int64, copy=False)
            bid = ticks["bid"].astype(np.float64, copy=False)
            last = ticks["last"].astype(np.float64, copy=False)
            prices = np.where(bid > 0.0, bid, last)
            valid = prices > 0.0
            if not np.any(valid):
                return []
            ts = ts[valid]
            prices = prices[valid]

            buckets = ts - (ts % 30)
            if len(buckets) > 1 and np.any(buckets[1:] < buckets[:-1]):
                order = np.argsort(buckets, kind="mergesort")
                buckets = buckets[order]
                prices = prices[order]

            is_new = np.empty(len(buckets), dtype=bool)
            is_new[0] = True
            if len(buckets) > 1:
                is_new[1:] = buckets[1:] != buckets[:-1]

            first_idx = np.flatnonzero(is_new)
            uniq_buckets = buckets[first_idx]

            # Limiter au maximum aux max_bars dernières bougies avant de réduire
            if len(uniq_buckets) > max_bars:
                cut = first_idx[-max_bars]
                buckets = buckets[cut:]
                prices = prices[cut:]
                first_idx = first_idx[-max_bars:] - cut
                uniq_buckets = uniq_buckets[-max_bars:]

            opens = prices[first_idx]
            end_idx = np.empty_like(first_idx)
            if len(first_idx) > 1:
                end_idx[:-1] = first_idx[1:] - 1
            end_idx[-1] = len(prices) - 1
            closes = prices[end_idx]
            counts = end_idx - first_idx + 1
            highs = np.maximum.reduceat(prices, first_idx)
            lows = np.minimum.reduceat(prices, first_idx)

            out: List[Dict[str, Any]] = []
            for idx in range(len(uniq_buckets)):
                bt = int(uniq_buckets[idx])
                out.append(
                    {
                        "time": bt,
                        "open": float(opens[idx]),
                        "high": float(highs[idx]),
                        "low": float(lows[idx]),
                        "close": float(closes[idx]),
                        "volume": float(counts[idx]),
                        "isForming": bt >= current_bucket,
                    }
                )
            return out
    except Exception:
        pass

    buckets_map: Dict[int, Dict[str, Any]] = {}
    for tick in ticks:
        ts = int(tick["time"])
        bucket_ts = ts - (ts % 30)
        bid = float(tick["bid"])
        last = float(tick["last"])
        price = bid if bid > 0 else last
        if price <= 0:
            continue

        if bucket_ts not in buckets_map:
            buckets_map[bucket_ts] = {
                "time": bucket_ts,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": 1.0,
            }
        else:
            b = buckets_map[bucket_ts]
            if price > b["high"]:
                b["high"] = price
            if price < b["low"]:
                b["low"] = price
            b["close"] = price
            b["volume"] += 1.0

    if not buckets_map:
        return []

    sorted_bars = [buckets_map[k] for k in sorted(buckets_map.keys())]
    if len(sorted_bars) > max_bars:
        sorted_bars = sorted_bars[-max_bars:]

    for b in sorted_bars:
        b["isForming"] = b["time"] >= current_bucket

    return sorted_bars

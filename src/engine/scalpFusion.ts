import {
  BreakoutLevelItem,
  CandleBar,
  ComputedBar,
  ComputedResult,
  EffectiveParams,
  ScalpFusionSettings,
  TIMEFRAME_SECONDS,
  Timeframe,
} from '../types/scalp';

function sma(values: number[], length: number): Array<number | null> {
  const n = values.length;
  const out: Array<number | null> = new Array(n).fill(null);
  if (length <= 0) return out;
  let running = 0;
  for (let i = 0; i < n; i++) {
    running += values[i];
    if (i >= length) running -= values[i - length];
    if (i >= length - 1) out[i] = running / length;
  }
  return out;
}

function smaOpt(values: Array<number | null>, length: number): Array<number | null> {
  const n = values.length;
  const out: Array<number | null> = new Array(n).fill(null);
  if (length <= 0) return out;
  for (let i = length - 1; i < n; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - length + 1; j <= i; j++) {
      const v = values[j];
      if (v === null) {
        valid = false;
        break;
      }
      sum += v;
    }
    if (valid) out[i] = sum / length;
  }
  return out;
}

function ema(values: number[], length: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (length <= 1) return [...values];
  const alpha = 2 / (length + 1);
  const out = new Array<number>(n);
  out[0] = values[0];
  for (let i = 1; i < n; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

function emaOpt(values: Array<number | null>, length: number): Array<number | null> {
  const n = values.length;
  const out: Array<number | null> = new Array(n).fill(null);
  if (length <= 1) return [...values];
  const alpha = 2 / (length + 1);
  let prev: number | null = null;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null) {
      out[i] = prev;
      continue;
    }
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rma(values: number[], length: number): Array<number | null> {
  const n = values.length;
  const out: Array<number | null> = new Array(n).fill(null);
  if (n === 0 || length <= 0) return out;
  const alpha = 1 / length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i < length - 1) {
      acc += values[i];
    } else if (i === length - 1) {
      acc += values[i];
      out[i] = acc / length;
    } else {
      const prev = out[i - 1] ?? values[i];
      out[i] = alpha * values[i] + (1 - alpha) * prev;
    }
  }
  return out;
}

function linreg(values: number[], length: number, offset = 0): Array<number | null> {
  const n = values.length;
  const out: Array<number | null> = new Array(n).fill(null);
  if (length <= 1) return values.map((v) => v);

  const sumX = (length * (length - 1)) / 2;
  const sumX2 = ((length - 1) * length * (2 * length - 1)) / 6;
  const denom = length * sumX2 - sumX * sumX;

  for (let i = length - 1; i < n; i++) {
    const start = i - length + 1;
    let sumY = 0;
    let sumXY = 0;
    for (let j = 0; j < length; j++) {
      const y = values[start + j];
      sumY += y;
      sumXY += j * y;
    }
    const slope = denom !== 0 ? (length * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / length;
    out[i] = intercept + slope * (length - 1 - offset);
  }
  return out;
}

export function resolveEffectiveParams(
  settings: ScalpFusionSettings,
  timeframe: Timeframe
): EffectiveParams {
  const tfSeconds = TIMEFRAME_SECONDS[timeframe];
  const isM1 =
    settings.profile === 'M1' ||
    (settings.profile === 'Auto (Timeframe)' && tfSeconds <= 60);
  const isCust = settings.profile === 'Custom';

  return {
    isM1,
    profileLabel: isCust ? 'Custom' : isM1 ? 'M1' : 'M3/M5',
    kvEff: isCust ? settings.kvManual : isM1 ? 1.2 : 1.5,
    atrEff: isCust ? settings.atrManual : 11,
    pacLen: isCust ? settings.pacManual : isM1 ? 13 : 21,
    fastLen: isCust ? settings.fastManual : isM1 ? 34 : 55,
    medLen: isCust ? settings.medManual : isM1 ? 89 : 144,
    slowLen: isCust ? settings.slowManual : isM1 ? 233 : 377,
    lbEff: isCust ? settings.lbManual : isM1 ? 2 : 3,
    lrLen: isCust ? settings.lrManual : isM1 ? 14 : 18,
    sigLen: isCust ? settings.sigManual : isM1 ? 9 : 11,
    srL: isCust ? settings.srLManual : isM1 ? 10 : 15,
    srR: isCust ? settings.srRManual : isM1 ? 10 : 15,
    boPerc: isCust ? settings.boPercManual : isM1 ? 0.01 : 0.03,
  };
}

export function computeScalpFusion(
  candles: CandleBar[],
  timeframe: Timeframe,
  settings: ScalpFusionSettings
): ComputedResult {
  const n = candles.length;
  const eff = resolveEffectiveParams(settings, timeframe);

  if (n === 0) {
    return {
      effectiveParams: eff,
      bars: [],
      breakoutLevels: null,
      summary: null,
    };
  }

  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume || 1);

  let srcO: number[];
  let srcH: number[];
  let srcL: number[];
  let srcC: number[];

  if (settings.useHA) {
    srcO = new Array(n);
    srcH = new Array(n);
    srcL = new Array(n);
    srcC = new Array(n);
    for (let i = 0; i < n; i++) {
      const haC = (opens[i] + highs[i] + lows[i] + closes[i]) / 4;
      const haO = i === 0 ? (opens[0] + closes[0]) / 2 : (srcO[i - 1] + srcC[i - 1]) / 2;
      srcC[i] = haC;
      srcO[i] = haO;
      srcH[i] = Math.max(highs[i], haO, haC);
      srcL[i] = Math.min(lows[i], haO, haC);
    }
  } else {
    srcO = opens;
    srcH = highs;
    srcL = lows;
    srcC = closes;
  }

  // 2. UT BOT
  const tr = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr[i] = srcH[i] - srcL[i];
    } else {
      tr[i] = Math.max(
        srcH[i] - srcL[i],
        Math.abs(srcH[i] - srcC[i - 1]),
        Math.abs(srcL[i] - srcC[i - 1])
      );
    }
  }
  const xAtrRaw = rma(tr, eff.atrEff);
  const xAtr = xAtrRaw.map((v, i) => (v !== null ? v : tr[i]));

  const xAtrStop = new Array<number>(n);
  const utPos = new Array<number>(n).fill(0);
  const utBuy = new Array<boolean>(n).fill(false);
  const utSell = new Array<boolean>(n).fill(false);
  const utEma = ema(srcC, 1);

  for (let i = 0; i < n; i++) {
    const nLoss = eff.kvEff * xAtr[i];
    const prevStop = i > 0 ? xAtrStop[i - 1] : 0;
    const prevC = i > 0 ? srcC[i - 1] : srcC[i];
    const currC = srcC[i];

    let stop: number;
    if (currC > prevStop && prevC > prevStop) {
      stop = Math.max(prevStop, currC - nLoss);
    } else if (currC < prevStop && prevC < prevStop) {
      stop = Math.min(prevStop, currC + nLoss);
    } else if (currC > prevStop) {
      stop = currC - nLoss;
    } else {
      stop = currC + nLoss;
    }
    xAtrStop[i] = stop;

    const prevPos = i > 0 ? utPos[i - 1] : 0;
    if (i > 0 && prevC < prevStop && currC > prevStop) {
      utPos[i] = 1;
    } else if (i > 0 && prevC > prevStop && currC < prevStop) {
      utPos[i] = -1;
    } else {
      utPos[i] = prevPos;
    }

    if (i > 0) {
      const prevEma = utEma[i - 1];
      const currEma = utEma[i];
      const utAbove = prevEma <= prevStop && currEma > stop;
      const utBelow = prevStop <= prevEma && stop > currEma;
      utBuy[i] = currC > stop && utAbove;
      utSell[i] = currC < stop && utBelow;
    }
  }

  // 3. SCALPTOOL
  const fastEMA = ema(srcC, eff.fastLen);
  const medEMA = ema(srcC, eff.medLen);
  const slowEMA = ema(srcC, eff.slowLen);
  const pacC = ema(srcC, eff.pacLen);
  const pacL = ema(srcL, eff.pacLen);
  const pacU = ema(srcH, eff.pacLen);

  const trendDir = new Array<number>(n).fill(0);
  const filteredTopF = new Array<boolean>(n).fill(false);
  const filteredBotF = new Array<boolean>(n).fill(false);
  const higherHigh = new Array<boolean>(n).fill(false);
  const lowerHigh = new Array<boolean>(n).fill(false);
  const higherLow = new Array<boolean>(n).fill(false);
  const lowerLow = new Array<boolean>(n).fill(false);
  const scBuy = new Array<boolean>(n).fill(false);
  const scSell = new Array<boolean>(n).fill(false);
  const tradeDir = new Array<number>(n).fill(0);

  const vhHist: number[] = [];
  const vlHist: number[] = [];
  let barsBelowC: number | null = null;
  let barsAboveC: number | null = null;

  for (let i = 0; i < n; i++) {
    if (fastEMA[i] > medEMA[i] && pacL[i] > medEMA[i]) {
      trendDir[i] = 1;
    } else if (fastEMA[i] < medEMA[i] && pacU[i] < medEMA[i]) {
      trendDir[i] = -1;
    } else {
      trendDir[i] = 0;
    }

    if (i >= 4) {
      let topF: boolean;
      let botF: boolean;
      if (settings.filterBW) {
        topF =
          highs[i - 4] < highs[i - 3] &&
          highs[i - 3] < highs[i - 2] &&
          highs[i - 2] > highs[i - 1] &&
          highs[i - 1] > highs[i];
        botF =
          lows[i - 4] > lows[i - 3] &&
          lows[i - 3] > lows[i - 2] &&
          lows[i - 2] < lows[i - 1] &&
          lows[i - 1] < lows[i];
      } else {
        topF =
          highs[i - 4] < highs[i - 2] &&
          highs[i - 3] <= highs[i - 2] &&
          highs[i - 2] >= highs[i - 1] &&
          highs[i - 2] > highs[i];
        botF =
          lows[i - 4] > lows[i - 2] &&
          lows[i - 3] >= lows[i - 2] &&
          lows[i - 2] <= lows[i - 1] &&
          lows[i - 2] < lows[i];
      }
      filteredTopF[i] = topF;
      filteredBotF[i] = botF;

      if (topF) {
        vhHist.unshift(highs[i - 2]);
        if (vhHist.length >= 3) {
          higherHigh[i] = vhHist[1] < vhHist[0] && vhHist[2] < vhHist[0];
          lowerHigh[i] = vhHist[1] > vhHist[0] && vhHist[2] > vhHist[0];
        }
      }
      if (botF) {
        vlHist.unshift(lows[i - 2]);
        if (vlHist.length >= 3) {
          higherLow[i] = vlHist[1] < vlHist[0] && vlHist[2] < vlHist[0];
          lowerLow[i] = vlHist[1] > vlHist[0] && vlHist[2] > vlHist[0];
        }
      }
    }

    if (srcC[i] < pacC[i]) {
      barsBelowC = 0;
    } else if (barsBelowC !== null) {
      barsBelowC += 1;
    }

    if (srcC[i] > pacC[i]) {
      barsAboveC = 0;
    } else if (barsAboveC !== null) {
      barsAboveC += 1;
    }

    const lbBelow = barsBelowC ?? eff.lbEff + 1;
    const lbAbove = barsAboveC ?? eff.lbEff + 1;
    const pacExitU = srcO[i] < pacU[i] && srcC[i] > pacU[i] && lbBelow <= eff.lbEff;
    const pacExitL = srcO[i] > pacL[i] && srcC[i] < pacL[i] && lbAbove <= eff.lbEff;

    scBuy[i] = trendDir[i] === 1 && pacExitU;
    scSell[i] = trendDir[i] === -1 && pacExitL;

    const prevTd = i > 0 ? tradeDir[i - 1] : 0;
    if (prevTd === 1 && srcC[i] < pacC[i]) {
      tradeDir[i] = 0;
    } else if (prevTd === -1 && srcC[i] > pacC[i]) {
      tradeDir[i] = 0;
    } else if (prevTd === 0 && scBuy[i]) {
      tradeDir[i] = 1;
    } else if (prevTd === 0 && scSell[i]) {
      tradeDir[i] = -1;
    } else {
      tradeDir[i] = prevTd;
    }
  }

  // 4. LRC
  let bOpen: number[];
  let bHigh: number[];
  let bLow: number[];
  let bClose: number[];
  let lrcSigRaw: Array<number | null>;

  if (settings.useLinReg) {
    const lrO = linreg(srcO, eff.lrLen, 0);
    const lrH = linreg(srcH, eff.lrLen, 0);
    const lrL = linreg(srcL, eff.lrLen, 0);
    const lrC = linreg(srcC, eff.lrLen, 0);
    bOpen = lrO.map((v, i) => (v !== null ? v : srcO[i]));
    bHigh = lrH.map((v, i) => (v !== null ? v : srcH[i]));
    bLow = lrL.map((v, i) => (v !== null ? v : srcL[i]));
    bClose = lrC.map((v, i) => (v !== null ? v : srcC[i]));
    lrcSigRaw = settings.smaSignal ? smaOpt(lrC, eff.sigLen) : emaOpt(lrC, eff.sigLen);
  } else {
    bOpen = [...srcO];
    bHigh = [...srcH];
    bLow = [...srcL];
    bClose = [...srcC];
    lrcSigRaw = settings.smaSignal ? sma(srcC, eff.sigLen) : ema(srcC, eff.sigLen);
  }
  const lrcBull = bOpen.map((o, i) => o < bClose[i]);

  // 5. S/R & VETO
  const srL = eff.srL;
  const srR = eff.srR;
  const pivHigh: Array<number | null> = new Array(n).fill(null);
  const pivLow: Array<number | null> = new Array(n).fill(null);

  for (let i = srL + srR; i < n; i++) {
    const candIdx = i - srR;
    const candH = highs[candIdx];
    const candL = lows[candIdx];
    let isPH = true;
    let isPL = true;
    for (let j = candIdx - srL; j < candIdx; j++) {
      if (highs[j] >= candH) isPH = false;
      if (lows[j] <= candL) isPL = false;
    }
    for (let j = candIdx + 1; j <= i; j++) {
      if (highs[j] > candH) isPH = false;
      if (lows[j] < candL) isPL = false;
    }
    if (isPH) pivHigh[i] = candH;
    if (isPL) pivLow[i] = candL;
  }

  const highUsePivot: Array<number | null> = new Array(n).fill(null);
  const lowUsePivot: Array<number | null> = new Array(n).fill(null);
  let lastPH: number | null = null;
  let lastPL: number | null = null;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      if (pivHigh[i - 1] !== null) lastPH = pivHigh[i - 1];
      if (pivLow[i - 1] !== null) lastPL = pivLow[i - 1];
    }
    highUsePivot[i] = lastPH;
    lowUsePivot[i] = lastPL;
  }

  const volShortE = ema(volumes, 5);
  const volLongE = ema(volumes, 10);
  const resBroken = new Array<boolean>(n).fill(false);
  const supBroken = new Array<boolean>(n).fill(false);
  const breakUp = new Array<boolean>(n).fill(false);
  const breakDn = new Array<boolean>(n).fill(false);
  const bullWick = new Array<boolean>(n).fill(false);
  const bearWick = new Array<boolean>(n).fill(false);
  const resTooClose = new Array<boolean>(n).fill(false);
  const supTooClose = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    const vLong = volLongE[i];
    const volOsc = vLong !== 0 ? (100 * (volShortE[i] - vLong)) / vLong : 0;
    const volOK = !settings.useVolFilt || volOsc > settings.volThresh;

    const phCurr = highUsePivot[i];
    const plCurr = lowUsePivot[i];
    if (i > 0) {
      const phPrev = highUsePivot[i - 1];
      const plPrev = lowUsePivot[i - 1];
      if (phCurr !== null && phPrev !== null) {
        const crossRes = closes[i - 1] <= phPrev && closes[i] > phCurr;
        resBroken[i] = crossRes && volOK;
        if (crossRes) {
          const wickCond = opens[i] - lows[i] > closes[i] - opens[i];
          breakUp[i] = resBroken[i] && !wickCond;
          bullWick[i] = wickCond;
        }
      }
      if (plCurr !== null && plPrev !== null) {
        const crossSup = closes[i - 1] >= plPrev && closes[i] < plCurr;
        supBroken[i] = crossSup && volOK;
        if (crossSup) {
          const wickCond = opens[i] - closes[i] < highs[i] - opens[i];
          breakDn[i] = supBroken[i] && !wickCond;
          bearWick[i] = wickCond;
        }
      }
    }

    const vetoDist = settings.vetoK * xAtr[i];
    if (settings.useSRVeto && phCurr !== null && phCurr > closes[i]) {
      resTooClose[i] = phCurr - closes[i] < vetoDist;
    }
    if (settings.useSRVeto && plCurr !== null && plCurr < closes[i]) {
      supTooClose[i] = closes[i] - plCurr < vetoDist;
    }
  }

  // 7. BREAKOUT PROBABILITY
  let boTotalG = 0;
  let boTotalR = 0;
  const boCounts = Array.from({ length: 5 }, () => [0, 0, 0, 0]);
  const boVals = Array.from({ length: 5 }, () => [0, 0, 0, 0]);
  let boWin = 0;
  let boLoss = 0;
  const boBullBias = new Array<boolean>(n).fill(true);

  for (let i = 1; i < n; i++) {
    const boGreen = closes[i - 1] > opens[i - 1];
    const boRed = closes[i - 1] < opens[i - 1];
    const boStep = closes[i] * (eff.boPerc / 100);

    if (boGreen) boTotalG += 1;
    if (boRed) boTotalR += 1;

    for (let k = 0; k < 5; k++) {
      const x = boStep * k;
      const hh = highs[i] >= highs[i - 1] + x;
      const ll = lows[i] <= lows[i - 1] - x;
      if (boGreen && hh && boTotalG > 0) {
        boCounts[k][0] += 1;
        boVals[k][0] = Math.round((boCounts[k][0] / boTotalG) * 10000) / 100;
      }
      if (boGreen && ll && boTotalG > 0) {
        boCounts[k][1] += 1;
        boVals[k][1] = Math.round((boCounts[k][1] / boTotalG) * 10000) / 100;
      }
      if (boRed && hh && boTotalR > 0) {
        boCounts[k][2] += 1;
        boVals[k][2] = Math.round((boCounts[k][2] / boTotalR) * 10000) / 100;
      }
      if (boRed && ll && boTotalR > 0) {
        boCounts[k][3] += 1;
        boVals[k][3] = Math.round((boCounts[k][3] / boTotalR) * 10000) / 100;
      }
    }

    const [a1, b1, a2, b2] = boVals[0];
    boBullBias[i] = boGreen ? Math.max(a1, b1) === a1 : Math.max(a2, b2) === a2;

    const targetV = boGreen
      ? Math.max(a1, b1) === a1
        ? highs[i - 1]
        : lows[i - 1]
      : Math.max(a2, b2) === a2
      ? highs[i - 1]
      : lows[i - 1];

    if (targetV === highs[i - 1]) {
      if (highs[i] >= targetV) boWin += 1;
      else boLoss += 1;
    } else {
      if (lows[i] <= targetV) boWin += 1;
      else boLoss += 1;
    }
  }

  // 6. SIGNAL FINAL
  const needN = settings.confMode === 'Stricte (2 filtres)' ? 2 : 1;
  const noFilt = settings.confMode === 'UT Bot seul';

  const barsOut: ComputedBar[] = [];
  let lastFinalSignal: 'ACHAT' | 'VENTE' | null = null;
  let lastFinalTime: number | null = null;

  for (let i = 0; i < n; i++) {
    const buyCnt = (trendDir[i] === 1 ? 1 : 0) + (lrcBull[i] ? 1 : 0);
    const sellCnt = (trendDir[i] === -1 ? 1 : 0) + (!lrcBull[i] ? 1 : 0);

    const rawBuy = utBuy[i] && (noFilt || buyCnt >= needN);
    const rawSell = utSell[i] && (noFilt || sellCnt >= needN);

    const finalBuy =
      rawBuy && !resTooClose[i] && (!settings.useBoFilter || boBullBias[i]);
    const finalSell =
      rawSell && !supTooClose[i] && (!settings.useBoFilter || !boBullBias[i]);

    const isForming = Boolean(candles[i].isForming);
    const confirmed = !isForming;
    const finalBuySig = finalBuy && (!settings.signalOnClose || confirmed);
    const finalSellSig = finalSell && (!settings.signalOnClose || confirmed);

    let vetoBlocked: 'VETO_RES' | 'VETO_SUP' | null = null;
    if (rawBuy && resTooClose[i]) vetoBlocked = 'VETO_RES';
    else if (rawSell && supTooClose[i]) vetoBlocked = 'VETO_SUP';

    if (finalBuySig) {
      lastFinalSignal = 'ACHAT';
      lastFinalTime = candles[i].time;
    } else if (finalSellSig) {
      lastFinalSignal = 'VENTE';
      lastFinalTime = candles[i].time;
    }

    barsOut.push({
      time: candles[i].time,
      open: opens[i],
      high: highs[i],
      low: lows[i],
      close: closes[i],
      volume: volumes[i],
      isForming,
      srcOpen: srcO[i],
      srcHigh: srcH[i],
      srcLow: srcL[i],
      srcClose: srcC[i],
      atr: xAtr[i],
      utStop: xAtrStop[i],
      utPos: utPos[i],
      utBuy: utBuy[i],
      utSell: utSell[i],
      fastEMA: fastEMA[i],
      medEMA: medEMA[i],
      slowEMA: slowEMA[i],
      pacC: pacC[i],
      pacL: pacL[i],
      pacU: pacU[i],
      trendDir: trendDir[i],
      scBuy: scBuy[i],
      scSell: scSell[i],
      tradeDir: tradeDir[i],
      fracTop: filteredTopF[i],
      fracBot: filteredBotF[i],
      hh: higherHigh[i],
      lh: lowerHigh[i],
      hl: higherLow[i],
      ll: lowerLow[i],
      bOpen: bOpen[i],
      bHigh: bHigh[i],
      bLow: bLow[i],
      bClose: bClose[i],
      lrcBull: lrcBull[i],
      lrcSignal: lrcSigRaw[i],
      srRes: highUsePivot[i],
      srSup: lowUsePivot[i],
      resBroken: resBroken[i],
      supBroken: supBroken[i],
      breakUp: breakUp[i],
      breakDn: breakDn[i],
      bullWick: bullWick[i],
      bearWick: bearWick[i],
      resTooClose: resTooClose[i],
      supTooClose: supTooClose[i],
      boBullBias: boBullBias[i],
      finalBuy,
      finalSell,
      finalBuySig,
      finalSellSig,
      vetoBlocked,
    });
  }

  const last = barsOut[n - 1];
  const prevBar = n >= 2 ? barsOut[n - 2] : last;
  const lastGreen = prevBar.close > prevBar.open;
  const step = last.close * (eff.boPerc / 100);
  const nbr = Math.max(1, Math.min(5, settings.boNbr));
  const upLevels: BreakoutLevelItem[] = [];
  const dnLevels: BreakoutLevelItem[] = [];

  for (let k = 0; k < nbr; k++) {
    const pUp = lastGreen ? boVals[k][0] : boVals[k][2];
    const pDn = lastGreen ? boVals[k][1] : boVals[k][3];
    upLevels.push({ price: prevBar.high + step * k, prob: pUp });
    dnLevels.push({ price: prevBar.low - step * k, prob: pDn });
  }

  const boWR =
    boWin + boLoss > 0 ? Math.round((boWin / (boWin + boLoss)) * 10000) / 100 : 0;

  const breakoutLevels = {
    upLevels,
    dnLevels,
    upProb0: lastGreen ? boVals[0][0] : boVals[0][2],
    dnProb0: lastGreen ? boVals[0][1] : boVals[0][3],
    bullBias: last.boBullBias,
    win: boWin,
    loss: boLoss,
    winRate: boWR,
  };

  const evalBar = settings.signalOnClose && last.isForming && n >= 2 ? barsOut[n - 2] : last;
  const prevClose = n >= 2 ? barsOut[n - 2].close : last.open;
  const changePct = prevClose !== 0 ? ((last.close - prevClose) / prevClose) * 100 : 0;

  let signalState: 'ACHAT' | 'VENTE' | 'VETO_RES' | 'VETO_SUP' | 'ATTENTE' = 'ATTENTE';
  if (evalBar.finalBuySig) signalState = 'ACHAT';
  else if (evalBar.finalSellSig) signalState = 'VENTE';
  else if (evalBar.vetoBlocked !== null) signalState = evalBar.vetoBlocked;

  return {
    effectiveParams: eff,
    bars: barsOut,
    breakoutLevels,
    summary: {
      price: last.close,
      prevClose,
      changePct,
      barTime: last.time,
      evalBarTime: evalBar.time,
      signalState,
      utPos: evalBar.utPos,
      utStop: evalBar.utStop,
      trendDir: evalBar.trendDir,
      lrcBull: evalBar.lrcBull,
      atr: evalBar.atr,
      srRes: evalBar.srRes,
      srSup: evalBar.srSup,
      resTooClose: evalBar.resTooClose,
      supTooClose: evalBar.supTooClose,
      boBullBias: breakoutLevels.bullBias,
      boUpProb: breakoutLevels.upProb0,
      boDnProb: breakoutLevels.dnProb0,
      lastFinalSignal,
      lastFinalTime,
    },
  };
}

/**
 * Parseur CSV/TSV exporté depuis MetaTrader 5 (Centre d'historique MT5 ou export TradingView)
 */
export function parseMt5Csv(text: string): CandleBar[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.replace(/[<>"]/g, '').trim().toUpperCase());

  const dateIdx = headers.findIndex((h) => h === 'DATE' || h === 'TIME' || h === 'DATETIME');
  const timeIdx = headers.findIndex((h) => h === 'TIME' && headers.indexOf('DATE') !== -1);
  const openIdx = headers.findIndex((h) => h === 'OPEN');
  const highIdx = headers.findIndex((h) => h === 'HIGH');
  const lowIdx = headers.findIndex((h) => h === 'LOW');
  const closeIdx = headers.findIndex((h) => h === 'CLOSE');
  const volIdx = headers.findIndex((h) => h === 'TICKVOL' || h === 'VOLUME' || h === 'VOL');

  const bars: CandleBar[] = [];
  const startRow = openIdx !== -1 ? 1 : 0;

  for (let i = startRow; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim());
    if (cols.length < 5) continue;

    let ts = 0;
    if (dateIdx !== -1 && timeIdx !== -1 && timeIdx !== dateIdx) {
      const dtStr = `${cols[dateIdx].replace(/\./g, '-')}T${cols[timeIdx]}Z`;
      const parsed = Date.parse(dtStr);
      ts = Number.isNaN(parsed) ? i * 60 : Math.floor(parsed / 1000);
    } else if (dateIdx !== -1) {
      const rawT = cols[dateIdx];
      if (/^\d{10,13}$/.test(rawT)) {
        ts = rawT.length === 13 ? Math.floor(Number(rawT) / 1000) : Number(rawT);
      } else {
        const parsed = Date.parse(rawT.replace(/\./g, '-'));
        ts = Number.isNaN(parsed) ? i * 60 : Math.floor(parsed / 1000);
      }
    } else {
      ts = i * 60;
    }

    const o = Number(cols[openIdx !== -1 ? openIdx : 1]);
    const h = Number(cols[highIdx !== -1 ? highIdx : 2]);
    const l = Number(cols[lowIdx !== -1 ? lowIdx : 3]);
    const c = Number(cols[closeIdx !== -1 ? closeIdx : 4]);
    const v = volIdx !== -1 ? Number(cols[volIdx]) : 1;

    if ([o, h, l, c].some((x) => !Number.isFinite(x))) continue;
    bars.push({
      time: ts,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(v) && v > 0 ? v : 1,
      isForming: false,
    });
  }

  return bars.sort((a, b) => a.time - b.time);
}

export function formatPrice(price: number | null | undefined, symbol = ''): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return '—';
  const upper = symbol.toUpperCase();
  if (upper.includes('JPY')) return price.toFixed(3);
  if (upper.includes('XAU') || upper.includes('GOLD') || upper.includes('US30') || upper.includes('USTEC') || upper.includes('NAS') || upper.includes('BTC')) {
    return price.toFixed(2);
  }
  if (price >= 100) return price.toFixed(2);
  if (price >= 10) return price.toFixed(3);
  return price.toFixed(5);
}

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, SlidersHorizontal, Upload } from 'lucide-react';
import { formatPrice } from '../engine/scalpFusion';
import {
  ComputedBar,
  ConfluenceMode,
  PairFeedState,
  ProfileMode,
  ScalpFusionSettings,
  Timeframe,
} from '../types/scalp';

interface ChartViewProps {
  pairs: string[];
  selectedSymbol: string;
  onSelectSymbol: (sym: string) => void;
  feeds: Record<string, PairFeedState>;
  timeframe: Timeframe;
  settings: ScalpFusionSettings;
  onUpdateSettings: (patch: Partial<ScalpFusionSettings>) => void;
  onResetSettings: () => void;
  darkMode: boolean;
  onOpenLocalSetup: () => void;
  onOpenCsvPickerForPair: (symbol: string) => void;
}

export function ChartView({
  pairs,
  selectedSymbol,
  onSelectSymbol,
  feeds,
  timeframe,
  settings,
  onUpdateSettings,
  onResetSettings,
  darkMode,
  onOpenLocalSetup,
  onOpenCsvPickerForPair,
}: ChartViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stcCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stcContainerRef = useRef<HTMLDivElement | null>(null);

  const [showSettingsDrawer, setShowSettingsDrawer] = useState(true);
  const [visibleCount, setVisibleCount] = useState(110);
  const [panOffset, setPanOffset] = useState(0); // bars from right edge
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  );
  const dragState = useRef<{ dragging: boolean; startX: number; startPan: number }>({
    dragging: false,
    startX: 0,
    startPan: 0,
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockText(
        new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const feed = feeds[selectedSymbol];
  const computed = feed?.computed;
  const bars = computed?.bars ?? [];
  const breakout = computed?.breakoutLevels;
  const eff = computed?.effectiveParams;

  // Reset pan when symbol/timeframe changes
  useEffect(() => {
    setPanOffset(0);
    setHoverIdx(null);
  }, [selectedSymbol, timeframe]);

  // Draw Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(380, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = darkMode ? '#0D131D' : '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    if (bars.length === 0) return;

    const padLeft = 12;
    const padRight = 76;
    const padTop = 18;
    const padBottom = 28;
    const plotW = Math.max(100, width - padLeft - padRight);
    const plotH = Math.max(100, height - padTop - padBottom);

    const endIdx = Math.max(1, bars.length - panOffset);
    const startIdx = Math.max(0, endIdx - visibleCount);
    const slice = bars.slice(startIdx, endIdx);
    if (slice.length === 0) return;

    // Price range
    let minP = Infinity;
    let maxP = -Infinity;
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      minP = Math.min(minP, b.low, b.srcLow);
      maxP = Math.max(maxP, b.high, b.srcHigh);
      if (settings.showLRC) {
        minP = Math.min(minP, b.bLow, b.bOpen, b.bClose);
        maxP = Math.max(maxP, b.bHigh, b.bOpen, b.bClose);
      }
      if (settings.showTrail && b.utStop > 0) {
        minP = Math.min(minP, b.utStop);
        maxP = Math.max(maxP, b.utStop);
      }
      if (settings.showPAC) {
        minP = Math.min(minP, b.pacL);
        maxP = Math.max(maxP, b.pacU);
      }
      if (settings.showFastEMA) {
        minP = Math.min(minP, b.fastEMA);
        maxP = Math.max(maxP, b.fastEMA);
      }
      if (settings.showMedEMA) {
        minP = Math.min(minP, b.medEMA);
        maxP = Math.max(maxP, b.medEMA);
      }
      if (settings.showSlowEMA) {
        minP = Math.min(minP, b.slowEMA);
        maxP = Math.max(maxP, b.slowEMA);
      }
    }

    if (settings.showBO && panOffset === 0 && breakout) {
      for (const lv of breakout.upLevels) {
        if (!settings.boHide0 || lv.prob > 0) maxP = Math.max(maxP, lv.price);
      }
      for (const lv of breakout.dnLevels) {
        if (!settings.boHide0 || lv.prob > 0) minP = Math.min(minP, lv.price);
      }
    }

    const span = maxP - minP || Math.max(1e-5, slice[0].close * 0.001);
    minP -= span * 0.06;
    maxP += span * 0.06;
    const priceSpan = maxP - minP;

    const rightMarginPx =
      panOffset === 0 ? Math.min(72, Math.max(40, Math.round(plotW * 0.075))) : 16;
    const candlesPlotW = Math.max(80, plotW - rightMarginPx);
    const barStep = candlesPlotW / slice.length;
    const candleW = Math.max(2, Math.min(14, Math.floor(barStep * 0.68)));
    const xAt = (localIdx: number) => padLeft + (localIdx + 0.5) * barStep;
    const yAt = (price: number) => padTop + ((maxP - price) / priceSpan) * plotH;

    // 1. Trend background
    if (settings.showTrendBG) {
      for (let i = 0; i < slice.length; i++) {
        const td = slice[i].trendDir;
        ctx.fillStyle =
          td === 1
            ? 'rgba(22, 163, 74, 0.06)'
            : td === -1
            ? 'rgba(220, 38, 38, 0.06)'
            : 'rgba(234, 179, 8, 0.03)';
        ctx.fillRect(padLeft + i * barStep, padTop, barStep + 0.5, plotH);
      }
    }

    // Grid lines
    const gridSteps = 6;
    ctx.strokeStyle = darkMode ? 'rgba(148, 163, 184, 0.09)' : 'rgba(15, 23, 42, 0.07)';
    ctx.lineWidth = 1;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = darkMode ? '#94A3B8' : '#64748B';
    ctx.textAlign = 'left';

    for (let g = 0; g <= gridSteps; g++) {
      const p = minP + (priceSpan * g) / gridSteps;
      const y = Math.round(yAt(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(formatPrice(p, selectedSymbol), width - padRight + 6, y + 3);
    }

    // Time ticks on bottom axis
    const timeTickStep = Math.max(1, Math.floor(slice.length / 7));
    ctx.textAlign = 'center';
    for (let i = 0; i < slice.length; i += timeTickStep) {
      const x = xAt(i);
      const d = new Date(slice[i].time * 1000);
      const label = d.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: timeframe === '30s' ? '2-digit' : undefined,
      });
      ctx.fillText(label, x, height - 8);
    }

    // 2. PAC Channel fill & lines
    if (settings.showPAC) {
      ctx.beginPath();
      for (let i = 0; i < slice.length; i++) {
        const x = xAt(i);
        const y = yAt(slice[i].pacU);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = slice.length - 1; i >= 0; i--) {
        ctx.lineTo(xAt(i), yAt(slice[i].pacL));
      }
      ctx.closePath();
      ctx.fillStyle = darkMode ? 'rgba(148, 163, 184, 0.10)' : 'rgba(100, 116, 139, 0.12)';
      ctx.fill();

      const drawLine = (
        getter: (b: ComputedBar) => number | null,
        color: string,
        lw: number
      ) => {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < slice.length; i++) {
          const val = getter(slice[i]);
          if (val === null || !Number.isFinite(val)) {
            started = false;
            continue;
          }
          const x = xAt(i);
          const y = yAt(val);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.stroke();
      };

      drawLine((b) => b.pacU, 'rgba(148, 163, 184, 0.55)', 1);
      drawLine((b) => b.pacL, 'rgba(148, 163, 184, 0.55)', 1);
      drawLine((b) => b.pacC, '#EF4444', 1.6);
    }

    // 3. EMAs
    const drawSeries = (getter: (b: ComputedBar) => number | null, color: string, lw: number) => {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < slice.length; i++) {
        const val = getter(slice[i]);
        if (val === null || !Number.isFinite(val)) {
          started = false;
          continue;
        }
        const x = xAt(i);
        const y = yAt(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
    };

    if (settings.showSlowEMA) drawSeries((b) => b.slowEMA, darkMode ? '#CBD5E1' : '#0F172A', 2.2);
    if (settings.showMedEMA) drawSeries((b) => b.medEMA, '#3B82F6', 2);
    if (settings.showFastEMA) drawSeries((b) => b.fastEMA, '#22C55E', 1.6);

    // 4. S/R Levels (step lines with Pine offset -(srR + 1) and clean discontinuity on jump)
    if (settings.showSR && eff) {
      const srOffset = eff.srR + 1;
      const drawSRLine = (getter: (b: ComputedBar) => number | null, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let prevVal: number | null = null;
        let started = false;
        for (let i = 0; i < slice.length; i++) {
          const globalIdx = startIdx + i + srOffset;
          if (globalIdx >= bars.length) break;
          const val = getter(bars[globalIdx]);
          if (val === null) {
            started = false;
            prevVal = null;
            continue;
          }
          const x = xAt(i);
          const y = yAt(val);
          if (!started || (prevVal !== null && Math.abs(val - prevVal) > 1e-12)) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
          prevVal = val;
        }
        ctx.stroke();
      };
      drawSRLine((b) => b.srRes, '#EF4444');
      drawSRLine((b) => b.srSup, '#2563EB');
    }

    // 5. Base Candlesticks (discrètes si LRC actif, pleines sinon)
    if (settings.showCandles) {
      for (let i = 0; i < slice.length; i++) {
        const b = slice[i];
        const wx = Math.round(xAt(i)) + 0.5;
        const bull = b.srcClose >= b.srcOpen;
        const alpha = settings.showLRC ? 0.28 : 0.96;
        const col = bull
          ? `rgba(34, 197, 94, ${alpha})`
          : `rgba(239, 68, 68, ${alpha})`;

        const wickHi = Math.max(b.srcHigh, b.srcOpen, b.srcClose);
        const wickLo = Math.min(b.srcLow, b.srcOpen, b.srcClose);

        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(wx, yAt(wickHi));
        ctx.lineTo(wx, yAt(wickLo));
        ctx.stroke();

        const yTop = Math.round(yAt(Math.max(b.srcOpen, b.srcClose)));
        const yBot = Math.round(yAt(Math.min(b.srcOpen, b.srcClose)));
        const bodyH = Math.max(1.5, yBot - yTop);
        const bx = Math.round(wx - candleW / 2);
        if (settings.showLRC) {
          ctx.strokeRect(bx + 0.5, yTop + 0.5, Math.max(2, candleW - 1), Math.max(1, bodyH - 1));
        } else {
          ctx.fillRect(bx, yTop, Math.max(2, candleW), bodyH);
        }
      }
    }

    // 6. LRC Candles & Signal Line
    if (settings.showLRC) {
      const lrcW = Math.max(2, Math.floor(candleW * 0.85));
      for (let i = 0; i < slice.length; i++) {
        const b = slice[i];
        const wx = Math.round(xAt(i)) + 0.5;
        const col = b.lrcBull ? '#38BDF8' : '#94A3B8';
        const wickHi = Math.max(b.bHigh, b.bOpen, b.bClose);
        const wickLo = Math.min(b.bLow, b.bOpen, b.bClose);

        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(wx, yAt(wickHi));
        ctx.lineTo(wx, yAt(wickLo));
        ctx.stroke();

        const yTop = Math.round(yAt(Math.max(b.bOpen, b.bClose)));
        const yBot = Math.round(yAt(Math.min(b.bOpen, b.bClose)));
        const bodyH = Math.max(2, yBot - yTop);
        const bx = Math.round(wx - lrcW / 2);
        ctx.fillRect(bx, yTop, lrcW, bodyH);
      }
    }
    if (settings.showSigLine) {
      drawSeries((b) => b.lrcSignal, darkMode ? '#F8FAFC' : '#0F172A', 1.2);
    }

    // 7. UT Bot Trailing Stop
    if (settings.showTrail) {
      for (let i = 1; i < slice.length; i++) {
        const prev = slice[i - 1];
        const curr = slice[i];
        if (prev.utStop <= 0 || curr.utStop <= 0) continue;
        ctx.strokeStyle =
          curr.utPos === 1 ? '#22C55E' : curr.utPos === -1 ? '#EF4444' : '#3B82F6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xAt(i - 1), yAt(prev.utStop));
        ctx.lineTo(xAt(i), yAt(curr.utStop));
        ctx.stroke();
      }
    }

    // 8. Breakout Probability Levels (on latest bar when panOffset === 0)
    if (settings.showBO && panOffset === 0 && breakout && slice.length >= 2) {
      const x1 = xAt(slice.length - 2);
      const x2 = width - padRight;
      const visibleUp = breakout.upLevels.filter((lv) => !settings.boHide0 || lv.prob > 0);
      const visibleDn = breakout.dnLevels.filter((lv) => !settings.boHide0 || lv.prob > 0);

      if (settings.boFillOn) {
        if (visibleUp.length >= 2) {
          const yTop = yAt(visibleUp[visibleUp.length - 1].price);
          const yBot = yAt(visibleUp[0].price);
          ctx.fillStyle = `${settings.boUpCol}22`;
          ctx.fillRect(x1, yTop, x2 - x1, yBot - yTop);
        }
        if (visibleDn.length >= 2) {
          const yTop = yAt(visibleDn[0].price);
          const yBot = yAt(visibleDn[visibleDn.length - 1].price);
          ctx.fillStyle = `${settings.boDnCol}22`;
          ctx.fillRect(x1, yTop, x2 - x1, yBot - yTop);
        }
      }

      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';

      for (const lv of visibleUp) {
        const y = yAt(lv.price);
        ctx.strokeStyle = settings.boUpCol;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = settings.boUpCol;
        ctx.fillText(`${lv.prob.toFixed(1)}%`, x2 + 6, y + 3);
      }

      for (const lv of visibleDn) {
        const y = yAt(lv.price);
        ctx.strokeStyle = settings.boDnCol;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = settings.boDnCol;
        ctx.fillText(`${lv.prob.toFixed(1)}%`, x2 + 6, y + 3);
      }
    }

    // 9. Markers: Fractals, HH/LL, Breaks, UT Raw, Final ACHAT/VENTE
    const drawTag = (x: number, y: number, text: string, bg: string, fg: string, above: boolean) => {
      ctx.font = 'bold 10px "DM Sans", sans-serif';
      const w = ctx.measureText(text).width + 10;
      const h = 17;
      const boxY = above ? y - h - 5 : y + 5;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, boxY, w, h, 4);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, boxY + h / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';
    };

    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      const x = xAt(i);

      if (settings.showFract) {
        const globalIdx = startIdx + i + 2;
        if (globalIdx < bars.length) {
          if (bars[globalIdx].fracTop) {
            ctx.fillStyle = '#EF4444';
            ctx.beginPath();
            const yt = yAt(b.high) - 6;
            ctx.moveTo(x, yt);
            ctx.lineTo(x - 4, yt - 6);
            ctx.lineTo(x + 4, yt - 6);
            ctx.closePath();
            ctx.fill();
          }
          if (bars[globalIdx].fracBot) {
            ctx.fillStyle = '#22C55E';
            ctx.beginPath();
            const yb = yAt(b.low) + 6;
            ctx.moveTo(x, yb);
            ctx.lineTo(x - 4, yb + 6);
            ctx.lineTo(x + 4, yb + 6);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      if (settings.showHHLL) {
        const globalIdx = startIdx + i + 2;
        if (globalIdx < bars.length) {
          const fb = bars[globalIdx];
          if (fb.hh) drawTag(x, yAt(b.high) - 4, 'HH', '#881337', '#FFFFFF', true);
          if (fb.lh) drawTag(x, yAt(b.high) - 4, 'LH', '#881337', '#FFFFFF', true);
          if (fb.hl) drawTag(x, yAt(b.low) + 4, 'HL', '#14532D', '#FFFFFF', false);
          if (fb.ll) drawTag(x, yAt(b.low) + 4, 'LL', '#14532D', '#FFFFFF', false);
        }
      }

      if (settings.showBreaks) {
        if (b.breakUp) drawTag(x, yAt(b.low), 'B', '#16A34A', '#FFFFFF', false);
        if (b.breakDn) drawTag(x, yAt(b.high), 'B', '#DC2626', '#FFFFFF', true);
        if (b.bullWick) drawTag(x, yAt(b.low), 'Bull Wick', '#15803D', '#FFFFFF', false);
        if (b.bearWick) drawTag(x, yAt(b.high), 'Bear Wick', '#B91C1C', '#FFFFFF', true);
      }

      if (settings.showScArrow) {
        const delay = settings.delayArrow ? 1 : 0;
        const gIdx = startIdx + i + delay;
        if (gIdx > 0 && gIdx < bars.length) {
          const prevTd = bars[gIdx - 1].tradeDir;
          const currTd = bars[gIdx].tradeDir;
          if (prevTd === 0 && currTd === 1) {
            drawTag(x, yAt(b.low) + 2, '▲ SC', '#16A34A', '#FFFFFF', false);
          } else if (prevTd === 0 && currTd === -1) {
            drawTag(x, yAt(b.high) - 2, '▼ SC', '#9F1239', '#FFFFFF', true);
          }
        }
      }

      if (settings.showUTRaw) {
        if (b.utBuy) drawTag(x, yAt(b.low), 'UT', '#15803D', '#FFFFFF', false);
        if (b.utSell) drawTag(x, yAt(b.high), 'UT', '#B91C1C', '#FFFFFF', true);
      }

      if (settings.showFinalSignals) {
        if (b.finalBuySig) {
          drawTag(x, yAt(b.low), 'ACHAT', '#16A34A', '#FFFFFF', false);
        }
        if (b.finalSellSig) {
          drawTag(x, yAt(b.high), 'VENTE', '#DC2626', '#FFFFFF', true);
        }
      }
    }

    // 10. Current Price Line
    const lastBar = slice[slice.length - 1];
    const lastY = Math.round(yAt(lastBar.close)) + 0.5;
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, lastY);
    ctx.lineTo(width - padRight, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#2563EB';
    ctx.fillRect(width - padRight + 2, lastY - 9, padRight - 6, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(formatPrice(lastBar.close, selectedSymbol), width - padRight + 6, lastY + 4);

    // 10b. Panneau Win/Loss Breakout optionnel sur le graphique
    if (settings.boShowPanel && breakout) {
      const boxW = 148;
      const boxH = 58;
      const boxX = width - padRight - boxW - 10;
      const boxY = padTop + 8;
      ctx.fillStyle = darkMode ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.94)';
      ctx.strokeStyle = darkMode ? 'rgba(148, 163, 184, 0.3)' : 'rgba(15, 23, 42, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#22C55E';
      ctx.fillText(`WIN: ${breakout.win}`, boxX + boxW / 2, boxY + 17);
      ctx.fillStyle = '#EF4444';
      ctx.fillText(`LOSS: ${breakout.loss}`, boxX + boxW / 2, boxY + 34);
      ctx.fillStyle = darkMode ? '#F1F5F9' : '#0F172A';
      ctx.fillText(`Profitabilité: ${breakout.winRate.toFixed(1)}%`, boxX + boxW / 2, boxY + 50);
    }

    // 11. Crosshair on Hover
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < slice.length) {
      const cx = xAt(hoverIdx);
      ctx.strokeStyle = darkMode ? 'rgba(226, 232, 240, 0.35)' : 'rgba(15, 23, 42, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, padTop);
      ctx.lineTo(cx, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [
    bars,
    breakout,
    eff,
    settings,
    visibleCount,
    panOffset,
    hoverIdx,
    darkMode,
    selectedSymbol,
    timeframe,
  ]);

  // Draw [SHK] Schaff Trend Cycle (STC) Sub-Pane
  useEffect(() => {
    if (!settings.showSTC) return;
    const canvas = stcCanvasRef.current;
    const container = stcContainerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(120, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = darkMode ? '#0D131D' : '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    if (bars.length === 0) return;

    const padLeft = 12;
    const padRight = 76;
    const padTop = 12;
    const padBottom = 14;
    const plotW = Math.max(100, width - padLeft - padRight);
    const plotH = Math.max(60, height - padTop - padBottom);

    const endIdx = Math.max(1, bars.length - panOffset);
    const startIdx = Math.max(0, endIdx - visibleCount);
    const slice = bars.slice(startIdx, endIdx);
    if (slice.length === 0) return;

    const rightMarginPx =
      panOffset === 0 ? Math.min(72, Math.max(40, Math.round(plotW * 0.075))) : 16;
    const candlesPlotW = Math.max(80, plotW - rightMarginPx);
    const barStep = candlesPlotW / slice.length;
    const xAt = (localIdx: number) => padLeft + (localIdx + 0.5) * barStep;
    const yAtVal = (v: number) => {
      const clamped = Math.max(-5, Math.min(105, v));
      return padTop + ((105 - clamped) / 110) * plotH;
    };

    // Shaded zone 25..75 (fill(ul, ll, color.new(color.gray, 96)))
    const y75 = yAtVal(75);
    const y25 = yAtVal(25);
    ctx.fillStyle = darkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(100, 116, 139, 0.08)';
    ctx.fillRect(padLeft, y75, width - padLeft - padRight, y25 - y75);

    // Horizontal levels 25 & 75 + axis labels 100, 75, 25, 0
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    for (const lv of [100, 75, 25, 0]) {
      const y = Math.round(yAtVal(lv)) + 0.5;
      ctx.strokeStyle =
        lv === 75 || lv === 25
          ? darkMode
            ? 'rgba(148, 163, 184, 0.32)'
            : 'rgba(100, 116, 139, 0.35)'
          : darkMode
          ? 'rgba(148, 163, 184, 0.08)'
          : 'rgba(15, 23, 42, 0.06)';
      ctx.lineWidth = 1;
      if (lv === 75 || lv === 25) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = darkMode ? '#94A3B8' : '#64748B';
      ctx.fillText(String(lv), width - padRight + 8, y + 3);
    }

    // STC colored curve (green when rising, red when falling)
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 1; i < slice.length; i++) {
      const prev = slice[i - 1];
      const curr = slice[i];
      ctx.strokeStyle = curr.stcBull ? 'rgba(34, 197, 94, 0.88)' : 'rgba(239, 68, 68, 0.88)';
      ctx.beginPath();
      ctx.moveTo(xAt(i - 1), yAtVal(prev.stc));
      ctx.lineTo(xAt(i), yAtVal(curr.stc));
      ctx.stroke();
    }

    // STC Alerts (< 25 turn up = Green, > 75 turn down = Red)
    if (settings.showSTCAlerts) {
      for (let i = 0; i < slice.length; i++) {
        const b = slice[i];
        const x = xAt(i);
        const y = yAtVal(b.stc);
        if (b.stcAlertGreen) {
          ctx.fillStyle = '#22C55E';
          ctx.beginPath();
          ctx.arc(x, y, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = darkMode ? '#0D131D' : '#FFFFFF';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (b.stcAlertRed) {
          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.arc(x, y, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = darkMode ? '#0D131D' : '#FFFFFF';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }

    // Current STC Badge on right axis
    const lastStc = slice[slice.length - 1];
    const lastStcY = Math.round(yAtVal(lastStc.stc)) + 0.5;
    ctx.fillStyle = lastStc.stcBull ? '#16A34A' : '#DC2626';
    ctx.fillRect(width - padRight + 2, lastStcY - 8, padRight - 10, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(lastStc.stc.toFixed(1), width - padRight + 7, lastStcY + 3.5);

    // Synchronized crosshair
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < slice.length) {
      const cx = xAt(hoverIdx);
      ctx.strokeStyle = darkMode ? 'rgba(226, 232, 240, 0.35)' : 'rgba(15, 23, 42, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, padTop);
      ctx.lineTo(cx, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [bars, settings.showSTC, settings.showSTCAlerts, visibleCount, panOffset, hoverIdx, darkMode]);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 12 : -12;
    setVisibleCount((prev) => Math.max(30, Math.min(360, prev + delta)));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragState.current = {
      dragging: true,
      startX: e.clientX,
      startPan: panOffset,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const plotW = Math.max(100, rect.width - 88);
    const rightMarginPx =
      panOffset === 0 ? Math.min(72, Math.max(40, Math.round(plotW * 0.075))) : 16;
    const candlesPlotW = Math.max(80, plotW - rightMarginPx);
    const shownCount = Math.max(1, Math.min(visibleCount, bars.length - panOffset));

    if (dragState.current.dragging) {
      const dx = e.clientX - dragState.current.startX;
      const barsPerPx = shownCount / candlesPlotW;
      const nextPan = Math.round(dragState.current.startPan + dx * barsPerPx);
      setPanOffset(Math.max(0, Math.min(Math.max(0, bars.length - 20), nextPan)));
      return;
    }

    const x = e.clientX - rect.left;
    const localIdx = Math.floor(((x - 12) / candlesPlotW) * shownCount);
    setHoverIdx(localIdx >= 0 && localIdx < shownCount ? localIdx : null);
  };

  const handleMouseUp = () => {
    dragState.current.dragging = false;
  };

  return (
    <div className="space-y-4">
      {/* Barre supérieure du graphique : onglets paires + contrôles couches */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {pairs.map((sym) => {
              const active = sym === selectedSymbol;
              const st = feeds[sym]?.computed?.summary?.signalState;
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => onSelectSymbol(sym)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-[#121924] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-400'
                  }`}
                >
                  {sym}
                  {(st === 'ACHAT' || st === 'VENTE') && (
                    <span className="ml-1.5 font-sans font-semibold">
                      {st === 'ACHAT' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            aria-label="Heure actuelle"
            className="pb-1 text-xs font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            {clockText}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPanOffset(0);
              setVisibleCount(110);
            }}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-white dark:bg-[#121924] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Recentrer</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSettingsDrawer((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              showSettingsDrawer
                ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                : 'bg-white dark:bg-[#121924] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Paramètres Pine v6</span>
          </button>
        </div>
      </div>

      {/* Zone principale : Canvas + Panneau Paramètres */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div
          className={`${
            showSettingsDrawer ? 'xl:col-span-9' : 'xl:col-span-12'
          } rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 overflow-hidden`}
        >
          {/* Bandeau Symbole + Valeurs Breakout Probability */}
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums">
              <span className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                {selectedSymbol} · {timeframe}
              </span>
              {breakout && (
                <>
                  <span
                    className={
                      breakout.bullBias
                        ? 'font-sans font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'font-sans font-semibold text-amber-600 dark:text-amber-400'
                    }
                  >
                    Breakout ({eff?.boPerc}%) · Biais {breakout.bullBias ? 'Haussier' : 'Baissier'}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    ↑ {breakout.upProb0.toFixed(1)}%
                  </span>
                  <span className="text-amber-600 dark:text-amber-400">
                    ↓ {breakout.dnProb0.toFixed(1)}%
                  </span>
                </>
              )}
            </div>

            {breakout && (
              <div className="font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                WIN {breakout.win} · LOSS {breakout.loss} · {breakout.winRate.toFixed(1)}%
              </div>
            )}
          </div>

          {/* Canvas ou état d'erreur / chargement */}
          {feed?.error && bars.length === 0 ? (
            <div className="h-[480px] flex flex-col items-center justify-center p-6 text-center">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400 max-w-md">
                {feed.error}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onOpenLocalSetup}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                >
                  Connecter MT5 Local
                </button>
                <button
                  type="button"
                  onClick={() => onOpenCsvPickerForPair(selectedSymbol)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Importer un CSV MT5
                </button>
              </div>
            </div>
          ) : bars.length === 0 ? (
            <div className="h-[480px] flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Chargement des bougies {selectedSymbol} ({timeframe})...
            </div>
          ) : (
            <>
              <div
                ref={containerRef}
                className={`w-full ${settings.showSTC ? 'h-[430px]' : 'h-[520px]'} relative select-none`}
              >
                <canvas
                  ref={canvasRef}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={() => {
                    handleMouseUp();
                    setHoverIdx(null);
                  }}
                  className="w-full h-full block cursor-crosshair"
                />
              </div>

              {settings.showSTC && (
                <div className="border-t border-slate-200 dark:border-slate-800">
                  {(() => {
                    const endIdx = Math.max(1, bars.length - panOffset);
                    const startIdx = Math.max(0, endIdx - visibleCount);
                    const slice = bars.slice(startIdx, endIdx);
                    const targetBar =
                      hoverIdx !== null && hoverIdx >= 0 && hoverIdx < slice.length
                        ? slice[hoverIdx]
                        : slice[slice.length - 1];
                    return (
                      <div className="px-4 py-1.5 flex items-center justify-between text-[11px] bg-slate-50/60 dark:bg-[#0B1018]/60 border-b border-slate-200/70 dark:border-slate-800/70">
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            STC ({settings.stcLength}, {settings.stcFastLength}, {settings.stcSlowLength})
                          </span>
                          {targetBar && (
                            <span
                              className={`font-semibold ${
                                targetBar.stcBull
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {targetBar.stc.toFixed(2)} ·{' '}
                              {targetBar.stcBull ? 'Haussier' : 'Baissier'}
                            </span>
                          )}
                          {targetBar?.stcAlertGreen && (
                            <span className="font-sans font-semibold text-emerald-600 dark:text-emerald-400">
                              ● Signal Vert (&lt;25)
                            </span>
                          )}
                          {targetBar?.stcAlertRed && (
                            <span className="font-sans font-semibold text-rose-600 dark:text-rose-400">
                              ● Signal Rouge (&gt;75)
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onUpdateSettings({ showSTC: false })}
                          className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          Masquer STC
                        </button>
                      </div>
                    );
                  })()}
                  <div ref={stcContainerRef} className="w-full h-[145px] relative select-none">
                    <canvas
                      ref={stcCanvasRef}
                      onWheel={handleWheel}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={() => {
                        handleMouseUp();
                        setHoverIdx(null);
                      }}
                      className="w-full h-full block cursor-crosshair"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Légende visuelle interactive (cliquer pour activer/désactiver) */}
          <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateSettings({ showFastEMA: !settings.showFastEMA })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showFastEMA
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" />
                <span>EMA Vert ({eff?.fastLen})</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showMedEMA: !settings.showMedEMA })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showMedEMA
                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2.5 h-0.5 bg-blue-500 inline-block" />
                <span>EMA Bleu ({eff?.medLen})</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showSlowEMA: !settings.showSlowEMA })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showSlowEMA
                    ? 'border-slate-400/50 bg-slate-500/10 text-slate-800 dark:text-slate-200 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2.5 h-0.5 bg-slate-400 inline-block" />
                <span>EMA Lente ({eff?.slowLen})</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showPAC: !settings.showPAC })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showPAC
                    ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2.5 h-0.5 bg-red-500 inline-block" />
                <span>Canal PAC</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showTrail: !settings.showTrail })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showTrail
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-slate-700 dark:text-slate-200 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2.5 h-0.5 bg-gradient-to-r from-emerald-500 to-red-500 inline-block" />
                <span>UT Stop</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showLRC: !settings.showLRC })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showLRC
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2 h-2 bg-sky-400 inline-block rounded-xs" />
                <span>Bougies LRC</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showSR: !settings.showSR })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showSR
                    ? 'border-blue-500/40 bg-blue-500/10 text-slate-700 dark:text-slate-200 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2.5 h-0.5 bg-gradient-to-r from-red-500 to-blue-600 inline-block" />
                <span>S/R</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showBO: !settings.showBO })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showBO
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2.5 h-0.5 border-b border-dashed border-amber-500 inline-block" />
                <span>Breakout</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showSTC: !settings.showSTC })}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
                  settings.showSTC
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-slate-700 dark:text-slate-200 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-70'
                }`}
              >
                <span className="w-2.5 h-0.5 bg-gradient-to-r from-emerald-500 to-rose-500 inline-block" />
                <span>STC ({settings.stcLength}/{settings.stcFastLength}/{settings.stcSlowLength})</span>
              </button>
            </div>
            <span className="text-[11px] text-slate-400 whitespace-nowrap">
              Molette : Zoom · Glisser : Historique
            </span>
          </div>
        </div>

        {/* Panneau complet des 7 groupes de paramètres Pine Script v6 */}
        {showSettingsDrawer && (
          <aside className="xl:col-span-3 rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 p-4 space-y-4 max-h-[615px] overflow-y-auto text-xs">
            <div className="space-y-2.5 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                  Paramètres SCALP FUSION
                </h3>
                <button
                  type="button"
                  onClick={onResetSettings}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Défauts
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      showCandles: true,
                      showTrail: true,
                      showUTRaw: true,
                      showFastEMA: true,
                      showMedEMA: true,
                      showSlowEMA: true,
                      showPAC: true,
                      showFract: true,
                      showHHLL: true,
                      showScArrow: true,
                      showTrendBG: true,
                      showLRC: true,
                      showSigLine: true,
                      showSR: true,
                      showBreaks: true,
                      useSRVeto: true,
                      showFinalSignals: true,
                      showBO: true,
                      boShowPanel: true,
                      showSTC: true,
                      showSTCAlerts: true,
                    })
                  }
                  className="h-7 px-2 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Tout activer
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      showTrail: false,
                      showUTRaw: false,
                      showFastEMA: false,
                      showMedEMA: false,
                      showSlowEMA: false,
                      showPAC: false,
                      showFract: false,
                      showHHLL: false,
                      showScArrow: false,
                      showTrendBG: false,
                      showLRC: false,
                      showSigLine: false,
                      showSR: false,
                      showBreaks: false,
                      showFinalSignals: false,
                      showBO: false,
                      boFillOn: false,
                      boShowPanel: false,
                      showSTC: false,
                      showSTCAlerts: false,
                    })
                  }
                  className="h-7 px-2 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Tout masquer
                </button>
              </div>
            </div>

            {/* 1. Général */}
            <div className="space-y-2">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                1. Général
              </div>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-400">Profil</span>
                <select
                  value={settings.profile}
                  onChange={(e) => onUpdateSettings({ profile: e.target.value as ProfileMode })}
                  className="h-7 px-2 text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="Auto (Timeframe)">Auto (TF)</option>
                  <option value="M1">M1</option>
                  <option value="M3/M5">M3/M5</option>
                  <option value="Custom">Custom</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-400">Bougies de base OHLC</span>
                <input
                  type="checkbox"
                  checked={settings.showCandles}
                  onChange={(e) => onUpdateSettings({ showCandles: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-400">Heikin Ashi source</span>
                <input
                  type="checkbox"
                  checked={settings.useHA}
                  onChange={(e) => onUpdateSettings({ useHA: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-400">Signaux sur bougie fermée</span>
                <input
                  type="checkbox"
                  checked={settings.signalOnClose}
                  onChange={(e) => onUpdateSettings({ signalOnClose: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
            </div>

            {/* 2. UT Bot */}
            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                2. UT Bot {settings.profile !== 'Custom' && `(Auto: ${eff?.kvEff} / ${eff?.atrEff})`}
              </div>
              {settings.profile === 'Custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-slate-500">Key Value</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={settings.kvManual}
                      onChange={(e) =>
                        onUpdateSettings({ kvManual: Math.max(0.1, Number(e.target.value)) })
                      }
                      className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-500">ATR Period</span>
                    <input
                      type="number"
                      min="1"
                      value={settings.atrManual}
                      onChange={(e) =>
                        onUpdateSettings({ atrManual: Math.max(1, Number(e.target.value)) })
                      }
                      className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                </div>
              )}
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Trailing stop UT Bot</span>
                <input
                  type="checkbox"
                  checked={settings.showTrail}
                  onChange={(e) => onUpdateSettings({ showTrail: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Labels UT bruts</span>
                <input
                  type="checkbox"
                  checked={settings.showUTRaw}
                  onChange={(e) => onUpdateSettings({ showUTRaw: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
            </div>

            {/* 3. SCALPTOOL */}
            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                3. SCALPTOOL (PAC {eff?.pacLen} · EMA {eff?.fastLen}/{eff?.medLen}/{eff?.slowLen})
              </div>
              {settings.profile === 'Custom' && (
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-slate-500">PAC</span>
                    <input
                      type="number"
                      min="2"
                      value={settings.pacManual}
                      onChange={(e) => onUpdateSettings({ pacManual: Math.max(2, Number(e.target.value)) })}
                      className="w-full h-7 px-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-500">EMA R</span>
                    <input
                      type="number"
                      min="2"
                      value={settings.fastManual}
                      onChange={(e) => onUpdateSettings({ fastManual: Math.max(2, Number(e.target.value)) })}
                      className="w-full h-7 px-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-500">EMA M</span>
                    <input
                      type="number"
                      min="2"
                      value={settings.medManual}
                      onChange={(e) => onUpdateSettings({ medManual: Math.max(2, Number(e.target.value)) })}
                      className="w-full h-7 px-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                  <label className="space-y-1 col-span-2">
                    <span className="text-slate-500">EMA Lente</span>
                    <input
                      type="number"
                      min="2"
                      value={settings.slowManual}
                      onChange={(e) => onUpdateSettings({ slowManual: Math.max(2, Number(e.target.value)) })}
                      className="w-full h-7 px-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-500">Lookback</span>
                    <input
                      type="number"
                      min="1"
                      value={settings.lbManual}
                      onChange={(e) => onUpdateSettings({ lbManual: Math.max(1, Number(e.target.value)) })}
                      className="w-full h-7 px-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" />
                    <span>EMA rapide (Vert · {eff?.fastLen})</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.showFastEMA}
                    onChange={(e) => onUpdateSettings({ showFastEMA: e.target.checked })}
                    className="accent-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <span className="w-2.5 h-0.5 bg-blue-500 inline-block" />
                    <span>EMA moyenne (Bleu · {eff?.medLen})</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.showMedEMA}
                    onChange={(e) => onUpdateSettings({ showMedEMA: e.target.checked })}
                    className="accent-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <span className="w-2.5 h-0.5 bg-slate-400 inline-block" />
                    <span>EMA lente (Gris/Blanc · {eff?.slowLen})</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.showSlowEMA}
                    onChange={(e) => onUpdateSettings({ showSlowEMA: e.target.checked })}
                    className="accent-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <span className="w-2.5 h-0.5 bg-red-500 inline-block" />
                    <span>Canal PAC ({eff?.pacLen})</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.showPAC}
                    onChange={(e) => onUpdateSettings({ showPAC: e.target.checked })}
                    className="accent-blue-600"
                  />
                </label>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1">
                  <label className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Fractales</span>
                    <input
                      type="checkbox"
                      checked={settings.showFract}
                      onChange={(e) => onUpdateSettings({ showFract: e.target.checked })}
                      className="accent-blue-600"
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">HH/LH/HL/LL</span>
                    <input
                      type="checkbox"
                      checked={settings.showHHLL}
                      onChange={(e) => onUpdateSettings({ showHHLL: e.target.checked })}
                      className="accent-blue-600"
                    />
                  </label>
                </div>
              </div>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Fractales idéales uniquement</span>
                <input
                  type="checkbox"
                  checked={settings.filterBW}
                  onChange={(e) => onUpdateSettings({ filterBW: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Flèches SCALPTOOL brutes</span>
                <input
                  type="checkbox"
                  checked={settings.showScArrow}
                  onChange={(e) => onUpdateSettings({ showScArrow: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Flèches SC sur bougie fermée</span>
                <input
                  type="checkbox"
                  checked={settings.delayArrow}
                  onChange={(e) => onUpdateSettings({ delayArrow: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Fond coloré tendance</span>
                <input
                  type="checkbox"
                  checked={settings.showTrendBG}
                  onChange={(e) => onUpdateSettings({ showTrendBG: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
            </div>

            {/* 4. LRC */}
            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                4. LRC ({eff?.lrLen}/{eff?.sigLen})
              </div>
              {settings.profile === 'Custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-slate-500">Régression</span>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={settings.lrManual}
                      onChange={(e) =>
                        onUpdateSettings({ lrManual: Math.max(1, Math.min(200, Number(e.target.value))) })
                      }
                      className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-500">Lissage signal</span>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={settings.sigManual}
                      onChange={(e) =>
                        onUpdateSettings({ sigManual: Math.max(1, Math.min(200, Number(e.target.value))) })
                      }
                      className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                </div>
              )}
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Régression active</span>
                <input
                  type="checkbox"
                  checked={settings.useLinReg}
                  onChange={(e) => onUpdateSettings({ useLinReg: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Bougies LRC</span>
                <input
                  type="checkbox"
                  checked={settings.showLRC}
                  onChange={(e) => onUpdateSettings({ showLRC: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Ligne signal LRC</span>
                <input
                  type="checkbox"
                  checked={settings.showSigLine}
                  onChange={(e) => onUpdateSettings({ showSigLine: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Signal = SMA (sinon EMA)</span>
                <input
                  type="checkbox"
                  checked={settings.smaSignal}
                  onChange={(e) => onUpdateSettings({ smaSignal: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
            </div>

            {/* 5. Support / Résistance */}
            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                5. Support / Résistance &amp; Veto ({eff?.srL}/{eff?.srR})
              </div>
              {settings.profile === 'Custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-slate-500">Barres gauche</span>
                    <input
                      type="number"
                      min="1"
                      value={settings.srLManual}
                      onChange={(e) =>
                        onUpdateSettings({ srLManual: Math.max(1, Number(e.target.value)) })
                      }
                      className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-500">Barres droite</span>
                    <input
                      type="number"
                      min="1"
                      value={settings.srRManual}
                      onChange={(e) =>
                        onUpdateSettings({ srRManual: Math.max(1, Number(e.target.value)) })
                      }
                      className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </label>
                </div>
              )}
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Afficher niveaux S/R</span>
                <input
                  type="checkbox"
                  checked={settings.showSR}
                  onChange={(e) => onUpdateSettings({ showSR: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Cassures (B / Wick)</span>
                <input
                  type="checkbox"
                  checked={settings.showBreaks}
                  onChange={(e) => onUpdateSettings({ showBreaks: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Filtre volume cassures</span>
                <input
                  type="checkbox"
                  checked={settings.useVolFilt}
                  onChange={(e) => onUpdateSettings({ useVolFilt: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              {settings.useVolFilt && (
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Seuil volume (%)</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={settings.volThresh}
                    onChange={(e) =>
                      onUpdateSettings({ volThresh: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-16 h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </label>
              )}
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Veto S/R actif</span>
                <input
                  type="checkbox"
                  checked={settings.useSRVeto}
                  onChange={(e) => onUpdateSettings({ useSRVeto: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-400">Distance veto (× ATR)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={settings.vetoK}
                  onChange={(e) =>
                    onUpdateSettings({ vetoK: Math.max(0.1, Number(e.target.value)) })
                  }
                  className="w-16 h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </label>
            </div>

            {/* 6. Signal final */}
            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                6. Signal final
              </div>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-400">Confluence</span>
                <select
                  value={settings.confMode}
                  onChange={(e) => onUpdateSettings({ confMode: e.target.value as ConfluenceMode })}
                  className="h-7 px-2 text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="Souple (≥1 filtre)">Souple (≥1 filtre)</option>
                  <option value="Stricte (2 filtres)">Stricte (2 filtres)</option>
                  <option value="UT Bot seul">UT Bot seul</option>
                </select>
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Signaux ACHAT / VENTE</span>
                <input
                  type="checkbox"
                  checked={settings.showFinalSignals}
                  onChange={(e) => onUpdateSettings({ showFinalSignals: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
            </div>

            {/* 7. Breakout Probability */}
            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                7. Breakout Probability (pas {eff?.boPerc}%)
              </div>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Afficher niveaux Breakout</span>
                <input
                  type="checkbox"
                  checked={settings.showBO}
                  onChange={(e) => onUpdateSettings({ showBO: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              {settings.profile === 'Custom' && (
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Pas niveaux (%)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={settings.boPercManual}
                    onChange={(e) =>
                      onUpdateSettings({ boPercManual: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-16 h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </label>
              )}
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-400">Niveaux (1–5)</span>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={settings.boNbr}
                  onChange={(e) =>
                    onUpdateSettings({
                      boNbr: Math.max(1, Math.min(5, Number(e.target.value))),
                    })
                  }
                  className="w-16 h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Couleur haut</span>
                  <input
                    type="color"
                    value={settings.boUpCol}
                    onChange={(e) => onUpdateSettings({ boUpCol: e.target.value })}
                    className="w-7 h-6 rounded border border-slate-300 dark:border-slate-700 bg-transparent cursor-pointer"
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Couleur bas</span>
                  <input
                    type="color"
                    value={settings.boDnCol}
                    onChange={(e) => onUpdateSettings({ boDnCol: e.target.value })}
                    className="w-7 h-6 rounded border border-slate-300 dark:border-slate-700 bg-transparent cursor-pointer"
                  />
                </label>
              </div>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Fond coloré niveaux</span>
                <input
                  type="checkbox"
                  checked={settings.boFillOn}
                  onChange={(e) => onUpdateSettings({ boFillOn: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Masquer niveaux à 0%</span>
                <input
                  type="checkbox"
                  checked={settings.boHide0}
                  onChange={(e) => onUpdateSettings({ boHide0: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Filtre biais de cassure (dur)</span>
                <input
                  type="checkbox"
                  checked={settings.useBoFilter}
                  onChange={(e) => onUpdateSettings({ useBoFilter: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Panneau Win/Loss</span>
                <input
                  type="checkbox"
                  checked={settings.boShowPanel}
                  onChange={(e) => onUpdateSettings({ boShowPanel: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
            </div>

            {/* 8. Schaff Trend Cycle (STC) */}
            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                8. Schaff Trend Cycle (STC)
              </div>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Afficher STC sous graphique</span>
                <input
                  type="checkbox"
                  checked={settings.showSTC}
                  onChange={(e) => onUpdateSettings({ showSTC: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Points alertes (25 / 75)</span>
                <input
                  type="checkbox"
                  checked={settings.showSTCAlerts}
                  onChange={(e) => onUpdateSettings({ showSTCAlerts: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-slate-500">Length</span>
                  <input
                    type="number"
                    min="1"
                    value={settings.stcLength}
                    onChange={(e) =>
                      onUpdateSettings({ stcLength: Math.max(1, Number(e.target.value)) })
                    }
                    className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-500">Factor (AAA)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="1"
                    value={settings.stcFactor}
                    onChange={(e) =>
                      onUpdateSettings({
                        stcFactor: Math.max(0.05, Math.min(1, Number(e.target.value))),
                      })
                    }
                    className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-500">FastLength</span>
                  <input
                    type="number"
                    min="1"
                    value={settings.stcFastLength}
                    onChange={(e) =>
                      onUpdateSettings({ stcFastLength: Math.max(1, Number(e.target.value)) })
                    }
                    className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-500">SlowLength</span>
                  <input
                    type="number"
                    min="1"
                    value={settings.stcSlowLength}
                    onChange={(e) =>
                      onUpdateSettings({ stcSlowLength: Math.max(1, Number(e.target.value)) })
                    }
                    className="w-full h-7 px-2 font-mono rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </label>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

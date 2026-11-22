import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddPairModal } from './components/AddPairModal';
import { AlertsView } from './components/AlertsView';
import { ChartView } from './components/ChartView';
import { Header } from './components/Header';
import { LocalMt5View } from './components/LocalMt5View';
import { ScannerView } from './components/ScannerView';
import { WorkspaceToolbar } from './components/WorkspaceToolbar';
import {
  computeScalpFusion,
  evaluateAlertOutcome,
  parseMt5Csv,
  resolveEffectiveParams,
} from './engine/scalpFusion';
import {
  ActiveTab,
  AlertLogEntry,
  CandleBar,
  DataSourceMode,
  DEFAULT_SETTINGS,
  Mt5HealthInfo,
  Mt5SymbolInfo,
  PairFeedState,
  ScalpFusionSettings,
  Timeframe,
} from './types/scalp';
import { playSignalChime } from './utils/soundAlert';

const STORAGE_KEYS = {
  PAIRS: 'scalp_fusion_pairs_v1',
  TIMEFRAME: 'scalp_fusion_tf_v1',
  SETTINGS: 'scalp_fusion_settings_v1',
  BRIDGE_URL: 'scalp_fusion_bridge_url_v1',
  DARK_MODE: 'scalp_fusion_dark_v1',
  ALERTS: 'scalp_fusion_alerts_v1',
};

const DEFAULT_PAIRS = ['EURUSDm', 'GBPUSDm', 'USDJPYm', 'XAUUSDm', 'BTCUSDm'];

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

class HtmlResponseError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HtmlResponseError';
    this.status = status;
  }
}

async function safeFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const trimmed = text.trimStart();
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html');

  if (isHtml) {
    throw new HtmlResponseError(
      res.status,
      `Réponse HTML inattendue (HTTP ${res.status}) : serveur API indisponible sur cette URL.`
    );
  }

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Réponse non-JSON reçue (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const maybeErr =
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Erreur HTTP ${res.status}`;
    throw new Error(maybeErr);
  }

  return parsed as T;
}

function resolveCryptoBinanceSymbol(symbol: string): string | null {
  let clean = symbol.trim().toUpperCase();
  for (const sfx of ['.R', '_M', 'M', 'C']) {
    if (clean.endsWith(sfx) && clean.length > sfx.length + 3) {
      clean = clean.slice(0, -sfx.length);
      break;
    }
  }
  const map: Record<string, string> = {
    BTCUSD: 'BTCUSDT',
    ETHUSD: 'ETHUSDT',
    SOLUSD: 'SOLUSDT',
    XRPUSD: 'XRPUSDT',
    BNBUSD: 'BNBUSDT',
    ADAUSD: 'ADAUSDT',
    DOGEUSD: 'DOGEUSDT',
    LTCUSD: 'LTCUSDT',
  };
  if (map[clean]) return map[clean];
  if (clean.endsWith('USDT')) return clean;
  return null;
}

async function fetchDirectBinanceCandles(
  binanceSymbol: string,
  timeframe: Timeframe,
  count = 450
): Promise<{ candles: CandleBar[]; resolvedSymbol: string; source: string }> {
  if (timeframe === '30s') {
    const trades = await safeFetchJson<Array<{ T: number; p: string; q: string }>>(
      `https://api.binance.com/api/v3/aggTrades?symbol=${encodeURIComponent(binanceSymbol)}&limit=1000`,
      { signal: AbortSignal.timeout(8000) }
    );
    const buckets = new Map<number, CandleBar>();
    for (const t of trades) {
      const tsSec = Math.floor(t.T / 1000);
      const bucketTs = tsSec - (tsSec % 30);
      const price = Number(t.p);
      const qty = Number(t.q);
      if (!Number.isFinite(price)) continue;
      const ex = buckets.get(bucketTs);
      if (!ex) {
        buckets.set(bucketTs, {
          time: bucketTs,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: qty,
        });
      } else {
        ex.high = Math.max(ex.high, price);
        ex.low = Math.min(ex.low, price);
        ex.close = price;
        ex.volume += qty;
      }
    }
    const nowBucket = Math.floor(Date.now() / 1000);
    const currentBucket = nowBucket - (nowBucket % 30);
    const candles = Array.from(buckets.values())
      .sort((a, b) => a.time - b.time)
      .slice(-count)
      .map((b) => ({ ...b, isForming: b.time >= currentBucket }));
    return {
      candles,
      resolvedSymbol: binanceSymbol,
      source: `Binance Direct 30s (${binanceSymbol})`,
    };
  }

  const tfMap: Record<string, { interval: string; resampleTo?: number; limit: number }> = {
    '1M': { interval: '1m', limit: count },
    '3M': { interval: '3m', limit: count },
    '5M': { interval: '5m', limit: count },
    '10M': { interval: '5m', resampleTo: 600, limit: Math.min(1000, count * 2) },
    '15M': { interval: '15m', limit: count },
  };
  const cfg = tfMap[timeframe] ?? { interval: '1m', limit: count };
  const raw = await safeFetchJson<Array<[number, string, string, string, string, string, number]>>(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
      binanceSymbol
    )}&interval=${cfg.interval}&limit=${cfg.limit}`,
    { signal: AbortSignal.timeout(8000) }
  );
  const nowMs = Date.now();
  let candles: CandleBar[] = raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    isForming: nowMs < k[6],
  }));
  if (cfg.resampleTo) {
    const buckets = new Map<number, CandleBar>();
    for (const b of candles) {
      const bucketTs = b.time - (b.time % cfg.resampleTo);
      const ex = buckets.get(bucketTs);
      if (!ex) {
        buckets.set(bucketTs, { ...b, time: bucketTs });
      } else {
        ex.high = Math.max(ex.high, b.high);
        ex.low = Math.min(ex.low, b.low);
        ex.close = b.close;
        ex.volume += b.volume;
        ex.isForming = Boolean(ex.isForming || b.isForming);
      }
    }
    candles = Array.from(buckets.values())
      .sort((a, b) => a.time - b.time)
      .slice(-count);
  }
  return {
    candles,
    resolvedSymbol: binanceSymbol,
    source: `Binance Direct (${binanceSymbol})`,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('scanner');
  const [pairs, setPairs] = useState<string[]>(() =>
    loadJson<string[]>(STORAGE_KEYS.PAIRS, DEFAULT_PAIRS)
  );
  const [timeframe, setTimeframe] = useState<Timeframe>(() =>
    loadJson<Timeframe>(STORAGE_KEYS.TIMEFRAME, '1M')
  );
  const [settings, setSettings] = useState<ScalpFusionSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...loadJson<Partial<ScalpFusionSettings>>(STORAGE_KEYS.SETTINGS, {}),
  }));
  const [bridgeUrl, setBridgeUrl] = useState<string>(() =>
    loadJson<string>(STORAGE_KEYS.BRIDGE_URL, 'http://127.0.0.1:8765')
  );
  const [dataSource, setDataSource] = useState<DataSourceMode>('auto');
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(15);
  const [darkMode, setDarkMode] = useState<boolean>(() =>
    loadJson<boolean>(STORAGE_KEYS.DARK_MODE, true)
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    () => pairs[0] || 'EURUSDm'
  );
  const [addModalOpen, setAddModalOpen] = useState(false);

  const [mt5Health, setMt5Health] = useState<Mt5HealthInfo | null>(null);
  const [checkingMt5, setCheckingMt5] = useState(false);
  const [mt5Symbols, setMt5Symbols] = useState<Mt5SymbolInfo[]>([]);

  const [feeds, setFeeds] = useState<Record<string, PairFeedState>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<AlertLogEntry[]>(() =>
    loadJson<AlertLogEntry[]>(STORAGE_KEYS.ALERTS, [])
  );

  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const csvTargetSymbolRef = useRef<string | null>(null);
  const csvStoreRef = useRef<Record<string, CandleBar[]>>({});
  const seenAlertIdsRef = useRef<Set<string>>(
    new Set(loadJson<AlertLogEntry[]>(STORAGE_KEYS.ALERTS, []).map((a) => a.id))
  );
  const initialLoadDoneRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts.slice(0, 200)));
    } catch {
      // Ignore storage quota errors
    }
  }, [alerts]);

  // Sync Tailwind dark class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(STORAGE_KEYS.DARK_MODE, JSON.stringify(darkMode));
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PAIRS, JSON.stringify(pairs));
    if (pairs.length > 0 && !pairs.includes(selectedSymbol)) {
      setSelectedSymbol(pairs[0]);
    }
  }, [pairs, selectedSymbol]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TIMEFRAME, JSON.stringify(timeframe));
  }, [timeframe]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.BRIDGE_URL, JSON.stringify(bridgeUrl));
  }, [bridgeUrl]);

  const effectiveParams = useMemo(
    () => resolveEffectiveParams(settings, timeframe),
    [settings, timeframe]
  );

  const cleanBridgeBase = useMemo(
    () => bridgeUrl.trim().replace(/\/+$/, '') || 'http://127.0.0.1:8765',
    [bridgeUrl]
  );

  const fetchMt5Symbols = useCallback(
    async (search = '') => {
      try {
        const json = await safeFetchJson<{ symbols?: Mt5SymbolInfo[] }>(
          `${cleanBridgeBase}/api/symbols?search=${encodeURIComponent(search)}&marketWatchOnly=${
            search ? 'false' : 'true'
          }`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (json.symbols) setMt5Symbols(json.symbols);
      } catch {
        // Ignore when bridge offline
      }
    },
    [cleanBridgeBase]
  );

  const checkMt5Health = useCallback(async (): Promise<boolean> => {
    setCheckingMt5(true);
    try {
      const info = await safeFetchJson<Mt5HealthInfo>(`${cleanBridgeBase}/api/health`, {
        signal: AbortSignal.timeout(2500),
      });
      setMt5Health(info);
      if (info.mt5Connected) {
        void fetchMt5Symbols('');
      }
      return Boolean(info.mt5Connected);
    } catch (err) {
      setMt5Health({
        ok: false,
        mt5Connected: false,
        error: err instanceof Error ? err.message : 'Inaccessible',
      });
      return false;
    } finally {
      setCheckingMt5(false);
    }
  }, [cleanBridgeBase, fetchMt5Symbols]);

  useEffect(() => {
    void checkMt5Health();
  }, [checkMt5Health]);

  const processPairAlerts = useCallback(
    (symbol: string, tf: Timeframe, source: string, bars: ReturnType<typeof computeScalpFusion>['bars']) => {
      if (bars.length === 0) return;
      const key = `${symbol}_${tf}`;
      const isInitial = !initialLoadDoneRef.current.has(key);
      const recentWindow = bars.slice(-15);
      const newEntries: AlertLogEntry[] = [];

      const buildEntry = (
        id: string,
        type: AlertLogEntry['type'],
        b: (typeof bars)[number],
        message: string
      ): AlertLogEntry => {
        const ev = evaluateAlertOutcome(
          { type, price: b.close, atr: b.atr, barTime: b.time },
          bars
        );
        return {
          id,
          symbol,
          timeframe: tf,
          type,
          price: b.close,
          atr: b.atr,
          barTime: b.time,
          message,
          source,
          outcome: ev.outcome,
          outcomeDiff: ev.diff,
          outcomePct: ev.pct,
          outcomeReason: ev.reason,
        };
      };

      for (const b of recentWindow) {
        if (b.finalBuySig) {
          const id = `${symbol}_${tf}_${b.time}_ACHAT`;
          if (!seenAlertIdsRef.current.has(id)) {
            seenAlertIdsRef.current.add(id);
            newEntries.push(
              buildEntry(id, 'ACHAT', b, `Signal SCALP FUSION ACHAT (UT Stop ${b.utStop.toFixed(5)})`)
            );
            if (!isInitial && soundEnabled && b.time === bars[bars.length - 1].time) {
              playSignalChime('ACHAT');
            }
          }
        }
        if (b.finalSellSig) {
          const id = `${symbol}_${tf}_${b.time}_VENTE`;
          if (!seenAlertIdsRef.current.has(id)) {
            seenAlertIdsRef.current.add(id);
            newEntries.push(
              buildEntry(id, 'VENTE', b, `Signal SCALP FUSION VENTE (UT Stop ${b.utStop.toFixed(5)})`)
            );
            if (!isInitial && soundEnabled && b.time === bars[bars.length - 1].time) {
              playSignalChime('VENTE');
            }
          }
        }
        if (b.breakUp) {
          const id = `${symbol}_${tf}_${b.time}_CRES`;
          if (!seenAlertIdsRef.current.has(id)) {
            seenAlertIdsRef.current.add(id);
            newEntries.push(
              buildEntry(id, 'CASSURE_RES', b, 'Cassure haussière de résistance S/R')
            );
          }
        }
        if (b.breakDn) {
          const id = `${symbol}_${tf}_${b.time}_CSUP`;
          if (!seenAlertIdsRef.current.has(id)) {
            seenAlertIdsRef.current.add(id);
            newEntries.push(
              buildEntry(id, 'CASSURE_SUP', b, 'Cassure baissière de support S/R')
            );
          }
        }
        if (b.stcAlertGreen && !b.isForming) {
          const id = `${symbol}_${tf}_${b.time}_STC_G`;
          if (!seenAlertIdsRef.current.has(id)) {
            seenAlertIdsRef.current.add(id);
            newEntries.push(
              buildEntry(
                id,
                'STC_VERT',
                b,
                `STC Vert : retournement haussier sous 25 (${b.stc.toFixed(1)})`
              )
            );
          }
        }
        if (b.stcAlertRed && !b.isForming) {
          const id = `${symbol}_${tf}_${b.time}_STC_R`;
          if (!seenAlertIdsRef.current.has(id)) {
            seenAlertIdsRef.current.add(id);
            newEntries.push(
              buildEntry(
                id,
                'STC_ROUGE',
                b,
                `STC Rouge : retournement baissier > 75 (${b.stc.toFixed(1)})`
              )
            );
          }
        }
      }

      initialLoadDoneRef.current.add(key);
      setAlerts((prev) => {
        let changed = newEntries.length > 0;
        const updatedPrev = prev.map((existing) => {
          if (
            existing.symbol === symbol &&
            existing.timeframe === tf &&
            existing.outcome !== 'WIN' &&
            existing.outcome !== 'LOSS'
          ) {
            const ev = evaluateAlertOutcome(existing, bars);
            if (
              ev.outcome !== existing.outcome ||
              ev.reason !== existing.outcomeReason ||
              ev.diff !== existing.outcomeDiff
            ) {
              changed = true;
              return {
                ...existing,
                outcome: ev.outcome,
                outcomeDiff: ev.diff,
                outcomePct: ev.pct,
                outcomeReason: ev.reason,
              };
            }
          }
          return existing;
        });
        if (!changed) return prev;
        return [...newEntries, ...updatedPrev]
          .sort((a, b) => b.barTime - a.barTime)
          .slice(0, 200);
      });
    },
    [soundEnabled]
  );

  // Recompute locally whenever settings change on already-loaded candles
  useEffect(() => {
    setFeeds((prev) => {
      const next: Record<string, PairFeedState> = {};
      for (const [sym, st] of Object.entries(prev)) {
        if (st.candles.length > 0 && st.timeframe === timeframe) {
          next[sym] = {
            ...st,
            computed: computeScalpFusion(st.candles, timeframe, settings),
          };
        } else {
          next[sym] = st;
        }
      }
      return next;
    });
  }, [settings, timeframe]);

  const refreshFeeds = useCallback(async () => {
    if (pairs.length === 0) return;
    setIsRefreshing(true);

    const useMt5 =
      dataSource === 'mt5' ||
      (dataSource === 'auto' && Boolean(mt5Health?.mt5Connected));

    if (dataSource === 'csv') {
      setFeeds((prev) => {
        const next: Record<string, PairFeedState> = { ...prev };
        for (const sym of pairs) {
          const csvBars = csvStoreRef.current[sym];
          if (csvBars && csvBars.length > 0) {
            const computed = computeScalpFusion(csvBars, timeframe, settings);
            next[sym] = {
              symbol: sym,
              resolvedSymbol: sym,
              timeframe,
              loading: false,
              error: null,
              source: 'CSV MT5 Importé',
              candles: csvBars,
              computed,
              updatedAt: Date.now(),
            };
          } else {
            next[sym] = {
              symbol: sym,
              resolvedSymbol: sym,
              timeframe,
              loading: false,
              error: 'Aucun fichier CSV importé pour cette paire.',
              source: 'CSV MT5',
              candles: [],
              computed: null,
              updatedAt: Date.now(),
            };
          }
        }
        return next;
      });
      setIsRefreshing(false);
      return;
    }

    // Mark loading if pair has no data for current timeframe
    setFeeds((prev) => {
      const next = { ...prev };
      for (const sym of pairs) {
        if (!next[sym] || next[sym].timeframe !== timeframe) {
          next[sym] = {
            symbol: sym,
            resolvedSymbol: sym,
            timeframe,
            loading: true,
            error: null,
            source: useMt5 ? 'MT5 Exness Local' : 'Flux Public',
            candles: [],
            computed: null,
            updatedAt: Date.now(),
          };
        }
      }
      return next;
    });

    if (useMt5) {
      try {
        const json = await safeFetchJson<{
          results: Array<{
            requestedSymbol: string;
            resolvedSymbol: string;
            ok: boolean;
            error?: string;
            source?: string;
            candles?: CandleBar[];
          }>;
        }>(`${cleanBridgeBase}/api/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbols: pairs,
            timeframe,
            count: 450,
            includeComputed: false,
          }),
          signal: AbortSignal.timeout(25000),
        });

        const updates: Record<string, PairFeedState> = {};
        for (const item of json.results) {
          if (item.ok && item.candles) {
            const computed = computeScalpFusion(item.candles, timeframe, settings);
            const src = item.source || 'MT5 Exness Local';
            processPairAlerts(item.requestedSymbol, timeframe, src, computed.bars);
            updates[item.requestedSymbol] = {
              symbol: item.requestedSymbol,
              resolvedSymbol: item.resolvedSymbol,
              timeframe,
              loading: false,
              error: null,
              source: src,
              candles: item.candles,
              computed,
              updatedAt: Date.now(),
            };
          } else {
            updates[item.requestedSymbol] = {
              symbol: item.requestedSymbol,
              resolvedSymbol: item.resolvedSymbol || item.requestedSymbol,
              timeframe,
              loading: false,
              error: item.error || 'Erreur lecture MT5',
              source: 'MT5 Exness Local',
              candles: [],
              computed: null,
              updatedAt: Date.now(),
            };
          }
        }
        setFeeds((prev) => ({ ...prev, ...updates }));
        setIsRefreshing(false);
        return;
      } catch (err) {
        if (dataSource === 'mt5' || timeframe === '30s') {
          const msg = err instanceof Error ? err.message : 'Pont MT5 inaccessible';
          setFeeds((prev) => {
            const next = { ...prev };
            for (const sym of pairs) {
              next[sym] = {
                symbol: sym,
                resolvedSymbol: sym,
                timeframe,
                loading: false,
                error: `Erreur pont MT5 local en ${timeframe} : ${msg}`,
                source: 'MT5 Exness Local',
                candles: [],
                computed: null,
                updatedAt: Date.now(),
              };
            }
            return next;
          });
          setIsRefreshing(false);
          return;
        }
      }
    }

    if (mt5Health === null && timeframe === '30s' && dataSource === 'auto') {
      setIsRefreshing(false);
      return;
    }

    // Public market proxy (/api/market/candles) or CSV override
    await Promise.all(
      pairs.map(async (sym) => {
        const csvOverride = csvStoreRef.current[sym];
        if (csvOverride && csvOverride.length > 0 && dataSource === 'auto') {
          const computed = computeScalpFusion(csvOverride, timeframe, settings);
          setFeeds((prev) => ({
            ...prev,
            [sym]: {
              symbol: sym,
              resolvedSymbol: sym,
              timeframe,
              loading: false,
              error: null,
              source: 'CSV MT5 Importé',
              candles: csvOverride,
              computed,
              updatedAt: Date.now(),
            },
          }));
          return;
        }

        try {
          let candles: CandleBar[] | undefined;
          let resolvedSymbol = sym;
          let src = 'Flux Public';

          try {
            const json = await safeFetchJson<{
              ok: boolean;
              resolvedSymbol?: string;
              source?: string;
              candles?: CandleBar[];
              error?: string;
            }>(
              `/api/market/candles?symbol=${encodeURIComponent(sym)}&timeframe=${encodeURIComponent(
                timeframe
              )}&count=450`,
              { signal: AbortSignal.timeout(10000) }
            );
            if (!json.ok || !json.candles) {
              throw new Error(json.error || 'Flux marché indisponible');
            }
            candles = json.candles;
            resolvedSymbol = json.resolvedSymbol || sym;
            src = json.source || 'Flux Public';
          } catch (proxyErr) {
            if (proxyErr instanceof HtmlResponseError) {
              const binanceSym = resolveCryptoBinanceSymbol(sym);
              if (binanceSym) {
                const direct = await fetchDirectBinanceCandles(binanceSym, timeframe, 450);
                candles = direct.candles;
                resolvedSymbol = direct.resolvedSymbol;
                src = direct.source;
              } else {
                throw new Error(
                  'Serveur proxy marché non actif sur cette URL (réponse HTML). Connectez votre pont Python MT5 Exness local ou importez un CSV MT5.'
                );
              }
            } else {
              throw proxyErr;
            }
          }

          const computed = computeScalpFusion(candles, timeframe, settings);
          processPairAlerts(sym, timeframe, src, computed.bars);
          setFeeds((prev) => ({
            ...prev,
            [sym]: {
              symbol: sym,
              resolvedSymbol,
              timeframe,
              loading: false,
              error: null,
              source: src,
              candles,
              computed,
              updatedAt: Date.now(),
            },
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Flux indisponible';
          setFeeds((prev) => ({
            ...prev,
            [sym]: {
              symbol: sym,
              resolvedSymbol: sym,
              timeframe,
              loading: false,
              error: msg,
              source: 'Flux Public',
              candles: [],
              computed: null,
              updatedAt: Date.now(),
            },
          }));
        }
      })
    );

    setIsRefreshing(false);
  }, [
    pairs,
    timeframe,
    dataSource,
    mt5Health,
    cleanBridgeBase,
    settings,
    processPairAlerts,
  ]);

  useEffect(() => {
    void refreshFeeds();
  }, [refreshFeeds]);

  // Auto-refresh interval
  useEffect(() => {
    if (refreshIntervalSec <= 0) return;
    const id = window.setInterval(() => {
      void refreshFeeds();
    }, refreshIntervalSec * 1000);
    return () => window.clearInterval(id);
  }, [refreshIntervalSec, refreshFeeds]);

  const handleAddPair = (symbol: string) => {
    const clean = symbol.trim();
    if (!clean) return;
    if (pairs.some((p) => p.toUpperCase() === clean.toUpperCase())) return;
    setPairs((prev) => [...prev, clean]);
    setSelectedSymbol(clean);
  };

  const handleRemovePair = (symbol: string) => {
    setPairs((prev) => prev.filter((p) => p !== symbol));
    setFeeds((prev) => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  };

  const handleOpenCsvPicker = (targetSym?: string) => {
    csvTargetSymbolRef.current = targetSym || selectedSymbol || pairs[0] || 'CSV_PAIR';
    csvInputRef.current?.click();
  };

  const handleCsvFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const bars = parseMt5Csv(text);
    if (bars.length < 10) return;

    const targetSym =
      csvTargetSymbolRef.current ||
      file.name.replace(/\.(csv|tsv|txt)$/i, '').split('_')[0] ||
      'EURUSDm';

    csvStoreRef.current[targetSym] = bars;
    if (!pairs.includes(targetSym)) {
      setPairs((prev) => [...prev, targetSym]);
    }
    setSelectedSymbol(targetSym);
    setDataSource('csv');
    const computed = computeScalpFusion(bars, timeframe, settings);
    setFeeds((prev) => ({
      ...prev,
      [targetSym]: {
        symbol: targetSym,
        resolvedSymbol: targetSym,
        timeframe,
        loading: false,
        error: null,
        source: `CSV MT5 (${file.name})`,
        candles: bars,
        computed,
        updatedAt: Date.now(),
      },
    }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#0B1018] dark:text-slate-100">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenAddPair={() => setAddModalOpen(true)}
        alertCount={alerts.length}
      />

      <WorkspaceToolbar
        timeframe={timeframe}
        onChangeTimeframe={setTimeframe}
        profile={settings.profile}
        onChangeProfile={(profile) => setSettings((s) => ({ ...s, profile }))}
        confMode={settings.confMode}
        onChangeConfMode={(confMode) => setSettings((s) => ({ ...s, confMode }))}
        dataSource={dataSource}
        onChangeDataSource={setDataSource}
        refreshIntervalSec={refreshIntervalSec}
        onChangeRefreshInterval={setRefreshIntervalSec}
        isRefreshing={isRefreshing}
        onRefreshNow={() => void refreshFeeds()}
        onOpenCsvPicker={() => handleOpenCsvPicker()}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        mt5Connected={Boolean(mt5Health?.mt5Connected)}
      />

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'scanner' && (
          <ScannerView
            pairs={pairs}
            feeds={feeds}
            timeframe={timeframe}
            effectiveParams={effectiveParams}
            mt5Connected={Boolean(mt5Health?.mt5Connected)}
            onAddPair={handleAddPair}
            onRemovePair={handleRemovePair}
            onOpenChart={(sym) => {
              setSelectedSymbol(sym);
              setActiveTab('chart');
            }}
            onOpenLocalSetup={() => setActiveTab('local')}
            onOpenCsvPickerForPair={(sym) => handleOpenCsvPicker(sym)}
          />
        )}

        {activeTab === 'chart' && (
          <ChartView
            pairs={pairs}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            feeds={feeds}
            timeframe={timeframe}
            settings={settings}
            onUpdateSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onResetSettings={() => setSettings(DEFAULT_SETTINGS)}
            darkMode={darkMode}
            onOpenLocalSetup={() => setActiveTab('local')}
            onOpenCsvPickerForPair={(sym) => handleOpenCsvPicker(sym)}
          />
        )}

        {activeTab === 'alerts' && (
          <AlertsView
            alerts={alerts}
            soundEnabled={soundEnabled}
            onToggleSound={() => setSoundEnabled((v) => !v)}
            onClearAlerts={() => {
              seenAlertIdsRef.current.clear();
              setAlerts([]);
            }}
            onOpenChart={(sym) => {
              setSelectedSymbol(sym);
              setActiveTab('chart');
            }}
          />
        )}

        {activeTab === 'local' && (
          <LocalMt5View
            bridgeUrl={bridgeUrl}
            onChangeBridgeUrl={setBridgeUrl}
            health={mt5Health}
            checking={checkingMt5}
            onTestConnection={() => void checkMt5Health()}
            mt5Symbols={mt5Symbols}
            onRefreshSymbols={(q) => void fetchMt5Symbols(q)}
            pairs={pairs}
            onAddPair={handleAddPair}
            onRemovePair={handleRemovePair}
          />
        )}
      </main>

      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,.tsv,.txt"
        onChange={handleCsvFileSelected}
        className="hidden"
      />

      <AddPairModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        existingPairs={pairs}
        onAddPair={handleAddPair}
        mt5Symbols={mt5Symbols}
      />
    </div>
  );
}

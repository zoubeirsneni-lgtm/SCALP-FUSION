import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isForming?: boolean;
}

interface CacheEntry {
  expiresAt: number;
  payload: {
    resolvedSymbol: string;
    sourceNote: string;
    candles: CandleBar[];
  };
}

const marketCache = new Map<string, CacheEntry>();

function stripExnessSuffix(symbol: string): string {
  let clean = symbol.trim().toUpperCase();
  for (const sfx of ['.R', '_M', 'M', 'C']) {
    if (clean.endsWith(sfx) && clean.length > sfx.length + 3) {
      clean = clean.slice(0, -sfx.length);
      break;
    }
  }
  return clean;
}

function isCryptoPair(base: string): string | null {
  const cryptoMap: Record<string, string> = {
    BTCUSD: 'BTCUSDT',
    ETHUSD: 'ETHUSDT',
    SOLUSD: 'SOLUSDT',
    XRPUSD: 'XRPUSDT',
    BNBUSD: 'BNBUSDT',
    ADAUSD: 'ADAUSDT',
    DOGEUSD: 'DOGEUSDT',
    LTCUSD: 'LTCUSDT',
  };
  if (cryptoMap[base]) return cryptoMap[base];
  if (base.endsWith('USDT')) return base;
  return null;
}

interface YahooTarget {
  ticker: string;
  invert?: boolean;
}

function toYahooTarget(base: string): YahooTarget {
  const map: Record<string, YahooTarget> = {
    EURUSD: { ticker: '6E=F' },
    GBPUSD: { ticker: '6B=F' },
    AUDUSD: { ticker: '6A=F' },
    NZDUSD: { ticker: '6N=F' },
    USDJPY: { ticker: '6J=F', invert: true },
    USDCAD: { ticker: '6C=F', invert: true },
    USDCHF: { ticker: '6S=F', invert: true },
    XAUUSD: { ticker: 'GC=F' },
    XAGUSD: { ticker: 'SI=F' },
    USOIL: { ticker: 'CL=F' },
    UKOIL: { ticker: 'BZ=F' },
    US30: { ticker: 'YM=F' },
    USTEC: { ticker: 'NQ=F' },
    NAS100: { ticker: 'NQ=F' },
    US500: { ticker: 'ES=F' },
    SPX500: { ticker: 'ES=F' },
    DE40: { ticker: '^GDAXI' },
    GER40: { ticker: '^GDAXI' },
    UK100: { ticker: '^FTSE' },
    DXY: { ticker: 'DX-Y.NYB' },
  };
  if (map[base]) return map[base];
  if (/^[A-Z]{6}$/.test(base)) return { ticker: `${base}=X` };
  return { ticker: base };
}

function resampleCandles(bars: CandleBar[], targetSec: number): CandleBar[] {
  if (bars.length === 0) return [];
  const buckets = new Map<number, CandleBar>();
  for (const b of bars) {
    const bucketTs = b.time - (b.time % targetSec);
    const existing = buckets.get(bucketTs);
    if (!existing) {
      buckets.set(bucketTs, {
        time: bucketTs,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        isForming: b.isForming,
      });
    } else {
      existing.high = Math.max(existing.high, b.high);
      existing.low = Math.min(existing.low, b.low);
      existing.close = b.close;
      existing.volume += b.volume;
      existing.isForming = Boolean(existing.isForming || b.isForming);
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

async function parseJsonSafe<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  const trimmed = text.trimStart();
  if (!res.ok) {
    if (trimmed.startsWith('<')) {
      throw new Error(`${label} HTTP ${res.status} (réponse HTML)`);
    }
    throw new Error(`${label} HTTP ${res.status}`);
  }
  if (trimmed.startsWith('<')) {
    throw new Error(`${label} a renvoyé du HTML au lieu de JSON`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} : réponse JSON invalide`);
  }
}

async function fetchBinanceCandles(
  binanceSymbol: string,
  timeframe: string,
  count: number
): Promise<{ candles: CandleBar[]; sourceNote: string }> {
  if (timeframe === '30s') {
    const url = `https://api.binance.com/api/v3/aggTrades?symbol=${encodeURIComponent(binanceSymbol)}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const trades = await parseJsonSafe<Array<{ T: number; p: string; q: string }>>(
      res,
      'Binance API'
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
    const sorted = Array.from(buckets.values())
      .sort((a, b) => a.time - b.time)
      .slice(-count)
      .map((b) => ({ ...b, isForming: b.time >= currentBucket }));
    return { candles: sorted, sourceNote: `Binance Trades 30s (${binanceSymbol})` };
  }

  const tfMap: Record<string, { interval: string; resampleTo?: number; limit: number }> = {
    '1M': { interval: '1m', limit: Math.min(1000, count) },
    '3M': { interval: '3m', limit: Math.min(1000, count) },
    '5M': { interval: '5m', limit: Math.min(1000, count) },
    '10M': { interval: '5m', resampleTo: 600, limit: Math.min(1000, count * 2) },
    '15M': { interval: '15m', limit: Math.min(1000, count) },
  };
  const cfg = tfMap[timeframe] ?? { interval: '1m', limit: Math.min(1000, count) };
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(binanceSymbol)}&interval=${cfg.interval}&limit=${cfg.limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const raw = await parseJsonSafe<
    Array<[number, string, string, string, string, string, number]>
  >(res, 'Binance API');
  const nowMs = Date.now();
  let bars: CandleBar[] = raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    isForming: nowMs < k[6],
  }));
  if (cfg.resampleTo) {
    bars = resampleCandles(bars, cfg.resampleTo).slice(-count);
  }
  return { candles: bars, sourceNote: `Binance Spot (${binanceSymbol})` };
}

async function fetchYahooCandles(
  target: YahooTarget,
  timeframe: string,
  count: number
): Promise<{ candles: CandleBar[]; sourceNote: string }> {
  if (timeframe === '30s') {
    throw new Error(
      'Le flux 30 secondes pour le Forex/Métaux nécessite les ticks temps réel de votre pont Python MT5 Exness local.'
    );
  }

  const tfCfg: Record<string, { interval: string; range: string; resampleTo?: number }> = {
    '1M': { interval: '1m', range: '5d', resampleTo: 60 },
    '3M': { interval: '1m', range: '5d', resampleTo: 180 },
    '5M': { interval: '5m', range: '5d', resampleTo: 300 },
    '10M': { interval: '5m', range: '5d', resampleTo: 600 },
    '15M': { interval: '15m', range: '5d', resampleTo: 900 },
  };
  const cfg = tfCfg[timeframe] ?? { interval: '1m', range: '5d', resampleTo: 60 };

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    target.ticker
  )}?interval=${cfg.interval}&range=${cfg.range}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  const json = await parseJsonSafe<{
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
      error?: { description?: string };
    };
  }>(res, `Yahoo Finance (${target.ticker})`);

  const result = json.chart?.result?.[0];
  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    throw new Error(json.chart?.error?.description || `Aucune donnée pour ${target.ticker}`);
  }

  const ts = result.timestamp;
  const q = result.indicators.quote[0];
  const tfSec = cfg.resampleTo ?? (timeframe === '1M' ? 60 : timeframe === '5M' ? 300 : 900);
  const nowSec = Math.floor(Date.now() / 1000);

  let bars: CandleBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const rawO = q.open?.[i];
    const rawH = q.high?.[i];
    const rawL = q.low?.[i];
    const rawC = q.close?.[i];
    if (rawO == null || rawH == null || rawL == null || rawC == null) continue;
    if (rawO <= 0 || rawH <= 0 || rawL <= 0 || rawC <= 0) continue;

    const o = target.invert ? 1 / rawO : rawO;
    const c = target.invert ? 1 / rawC : rawC;
    const h = target.invert ? 1 / rawL : rawH;
    const l = target.invert ? 1 / rawH : rawL;

    bars.push({
      time: ts[i],
      open: o,
      high: Math.max(h, o, c),
      low: Math.min(l, o, c),
      close: c,
      volume: q.volume?.[i] && q.volume[i]! > 0 ? q.volume[i]! : 1,
      isForming: nowSec < ts[i] + tfSec,
    });
  }

  if (cfg.resampleTo) {
    bars = resampleCandles(bars, cfg.resampleTo);
  }
  return {
    candles: bars.slice(-count),
    sourceNote: `Flux Public (${target.ticker})`,
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Buf(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = entry.data;
    const crc = crc32Buf(dataBuf);
    const size = dataBuf.length;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, dataBuf);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralBuf.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, endRecord]);
}

function collectDirFiles(
  dirPath: string,
  zipPrefix: string,
  out: Array<{ name: string; data: Buffer }>
) {
  if (!fs.existsSync(dirPath)) return;
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of items) {
    if (item.name === '__pycache__' || item.name === '.venv' || item.name.endsWith('.pyc')) {
      continue;
    }
    const full = path.join(dirPath, item.name);
    const rel = `${zipPrefix}/${item.name}`;
    if (item.isDirectory()) {
      collectDirFiles(full, rel, out);
    } else if (item.isFile()) {
      out.push({ name: rel, data: fs.readFileSync(full) });
    }
  }
}

let distBuildLock: Promise<void> | null = null;
let lastBuiltAt = 0;

async function ensureDistReady(): Promise<void> {
  const distIndex = path.join(__dirname, 'dist', 'index.html');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distIndex)) {
    return;
  }
  if (fs.existsSync(distIndex) && Date.now() - lastBuiltAt < 15_000) {
    return;
  }
  if (!distBuildLock) {
    distBuildLock = (async () => {
      try {
        const { build } = await import('vite');
        await build({ root: __dirname, logLevel: 'silent' });
        lastBuiltAt = Date.now();
      } finally {
        distBuildLock = null;
      }
    })();
  }
  await distBuildLock;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'scalp-fusion-web' });
  });

  app.get('/api/local-bundle.zip', async (_req, res) => {
    try {
      await ensureDistReady();
      const entries: Array<{ name: string; data: Buffer }> = [];
      collectDirFiles(path.join(__dirname, 'python_local'), 'scalp_fusion_pc_local', entries);
      collectDirFiles(path.join(__dirname, 'dist'), 'scalp_fusion_pc_local/dist', entries);
      const zipBuf = buildZipBuffer(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="scalp_fusion_pc_local.zip"'
      );
      res.setHeader('Content-Length', String(zipBuf.length));
      res.send(zipBuf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur création du pack local';
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get('/api/market/candles', async (req, res) => {
    const symbol = String(req.query.symbol || 'EURUSDm');
    const timeframe = String(req.query.timeframe || '1M');
    const count = Math.min(1000, Math.max(100, Number(req.query.count || 450)));

    const cacheKey = `${symbol.toUpperCase()}_${timeframe}_${count}`;
    const cached = marketCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({
        ok: true,
        symbol,
        resolvedSymbol: cached.payload.resolvedSymbol,
        timeframe,
        source: cached.payload.sourceNote,
        candles: cached.payload.candles,
      });
      return;
    }

    try {
      const base = stripExnessSuffix(symbol);
      const binanceSym = isCryptoPair(base);
      if (binanceSym) {
        const data = await fetchBinanceCandles(binanceSym, timeframe, count);
        marketCache.set(cacheKey, {
          expiresAt: Date.now() + 10_000,
          payload: {
            resolvedSymbol: binanceSym,
            sourceNote: data.sourceNote,
            candles: data.candles,
          },
        });
        res.json({
          ok: true,
          symbol,
          resolvedSymbol: binanceSym,
          timeframe,
          source: data.sourceNote,
          candles: data.candles,
        });
        return;
      }

      const target = toYahooTarget(base);
      const data = await fetchYahooCandles(target, timeframe, count);
      marketCache.set(cacheKey, {
        expiresAt: Date.now() + 15_000,
        payload: {
          resolvedSymbol: target.ticker,
          sourceNote: data.sourceNote,
          candles: data.candles,
        },
      });
      res.json({
        ok: true,
        symbol,
        resolvedSymbol: target.ticker,
        timeframe,
        source: data.sourceNote,
        candles: data.candles,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur flux marché public';
      res.status(502).json({
        ok: false,
        symbol,
        timeframe,
        error: msg,
      });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Route API introuvable' });
  });

  const isProd =
    process.env.NODE_ENV === 'production' ||
    fs.existsSync(path.join(__dirname, 'dist', 'index.html'));

  if (!isProd || process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`SCALP FUSION server listening on http://0.0.0.0:${port}`);
  });
}

startServer();

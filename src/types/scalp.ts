export type Timeframe = '30s' | '1M' | '3M' | '5M' | '10M' | '15M';

export const TIMEFRAMES: Timeframe[] = ['30s', '1M', '3M', '5M', '10M', '15M'];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '30s': 30,
  '1M': 60,
  '3M': 180,
  '5M': 300,
  '10M': 600,
  '15M': 900,
};

export type ProfileMode = 'Auto (Timeframe)' | 'M1' | 'M3/M5' | 'Custom';
export type ConfluenceMode = 'Souple (≥1 filtre)' | 'Stricte (2 filtres)' | 'UT Bot seul';
export type ActiveTab = 'scanner' | 'chart' | 'alerts' | 'local';
export type DataSourceMode = 'auto' | 'mt5' | 'public' | 'csv';

export interface ScalpFusionSettings {
  // 1. Général
  profile: ProfileMode;
  useHA: boolean;
  signalOnClose: boolean;
  showCandles: boolean;

  // 2. UT Bot
  kvManual: number;
  atrManual: number;
  showTrail: boolean;
  showUTRaw: boolean;

  // 3. SCALPTOOL
  pacManual: number;
  fastManual: number;
  medManual: number;
  slowManual: number;
  lbManual: number;
  showFastEMA: boolean;
  showMedEMA: boolean;
  showSlowEMA: boolean;
  showPAC: boolean;
  showFract: boolean;
  filterBW: boolean;
  showHHLL: boolean;
  showScArrow: boolean;
  delayArrow: boolean;
  showTrendBG: boolean;

  // 4. LRC
  lrManual: number;
  sigManual: number;
  smaSignal: boolean;
  useLinReg: boolean;
  showLRC: boolean;
  showSigLine: boolean;

  // 5. Support / Résistance
  srLManual: number;
  srRManual: number;
  useVolFilt: boolean;
  volThresh: number;
  showSR: boolean;
  showBreaks: boolean;
  useSRVeto: boolean;
  vetoK: number;

  // 6. Signal final
  confMode: ConfluenceMode;
  showFinalSignals: boolean;

  // 7. Breakout Probability
  showBO: boolean;
  boPercManual: number;
  boNbr: number;
  boUpCol: string;
  boDnCol: string;
  boFillOn: boolean;
  boHide0: boolean;
  boShowPanel: boolean;
  useBoFilter: boolean;
}

export const DEFAULT_SETTINGS: ScalpFusionSettings = {
  profile: 'Auto (Timeframe)',
  useHA: false,
  signalOnClose: true,
  showCandles: true,

  kvManual: 1.2,
  atrManual: 11,
  showTrail: true,
  showUTRaw: false,

  pacManual: 13,
  fastManual: 34,
  medManual: 89,
  slowManual: 233,
  lbManual: 2,
  showFastEMA: true,
  showMedEMA: true,
  showSlowEMA: false,
  showPAC: true,
  showFract: false,
  filterBW: false,
  showHHLL: false,
  showScArrow: false,
  delayArrow: true,
  showTrendBG: true,

  lrManual: 14,
  sigManual: 9,
  smaSignal: true,
  useLinReg: true,
  showLRC: true,
  showSigLine: true,

  srLManual: 10,
  srRManual: 10,
  useVolFilt: false,
  volThresh: 20.0,
  showSR: true,
  showBreaks: true,
  useSRVeto: true,
  vetoK: 1.0,

  confMode: 'Souple (≥1 filtre)',
  showFinalSignals: true,

  showBO: true,
  boPercManual: 0.01,
  boNbr: 3,
  boUpCol: '#4CAF50',
  boDnCol: '#FF9800',
  boFillOn: false,
  boHide0: true,
  boShowPanel: false,
  useBoFilter: false,
};

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isForming?: boolean;
}

export interface EffectiveParams {
  isM1: boolean;
  profileLabel: string;
  kvEff: number;
  atrEff: number;
  pacLen: number;
  fastLen: number;
  medLen: number;
  slowLen: number;
  lbEff: number;
  lrLen: number;
  sigLen: number;
  srL: number;
  srR: number;
  boPerc: number;
}

export interface ComputedBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isForming: boolean;
  srcOpen: number;
  srcHigh: number;
  srcLow: number;
  srcClose: number;
  atr: number;
  utStop: number;
  utPos: number;
  utBuy: boolean;
  utSell: boolean;
  fastEMA: number;
  medEMA: number;
  slowEMA: number;
  pacC: number;
  pacL: number;
  pacU: number;
  trendDir: number;
  scBuy: boolean;
  scSell: boolean;
  tradeDir: number;
  fracTop: boolean;
  fracBot: boolean;
  hh: boolean;
  lh: boolean;
  hl: boolean;
  ll: boolean;
  bOpen: number;
  bHigh: number;
  bLow: number;
  bClose: number;
  lrcBull: boolean;
  lrcSignal: number | null;
  srRes: number | null;
  srSup: number | null;
  resBroken: boolean;
  supBroken: boolean;
  breakUp: boolean;
  breakDn: boolean;
  bullWick: boolean;
  bearWick: boolean;
  resTooClose: boolean;
  supTooClose: boolean;
  boBullBias: boolean;
  finalBuy: boolean;
  finalSell: boolean;
  finalBuySig: boolean;
  finalSellSig: boolean;
  vetoBlocked: 'VETO_RES' | 'VETO_SUP' | null;
}

export interface BreakoutLevelItem {
  price: number;
  prob: number;
}

export interface BreakoutInfo {
  upLevels: BreakoutLevelItem[];
  dnLevels: BreakoutLevelItem[];
  upProb0: number;
  dnProb0: number;
  bullBias: boolean;
  win: number;
  loss: number;
  winRate: number;
}

export interface PairSummary {
  price: number;
  prevClose: number;
  changePct: number;
  barTime: number;
  evalBarTime: number;
  signalState: 'ACHAT' | 'VENTE' | 'VETO_RES' | 'VETO_SUP' | 'ATTENTE';
  utPos: number;
  utStop: number;
  trendDir: number;
  lrcBull: boolean;
  atr: number;
  srRes: number | null;
  srSup: number | null;
  resTooClose: boolean;
  supTooClose: boolean;
  boBullBias: boolean;
  boUpProb: number;
  boDnProb: number;
  lastFinalSignal: 'ACHAT' | 'VENTE' | null;
  lastFinalTime: number | null;
}

export interface ComputedResult {
  effectiveParams: EffectiveParams;
  bars: ComputedBar[];
  breakoutLevels: BreakoutInfo | null;
  summary: PairSummary | null;
}

export interface PairFeedState {
  symbol: string;
  resolvedSymbol: string;
  timeframe: Timeframe;
  loading: boolean;
  error: string | null;
  source: string;
  candles: CandleBar[];
  computed: ComputedResult | null;
  updatedAt: number;
}

export interface AlertLogEntry {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  type: 'ACHAT' | 'VENTE' | 'CASSURE_RES' | 'CASSURE_SUP' | 'VETO';
  price: number;
  barTime: number;
  message: string;
  source: string;
}

export interface Mt5HealthInfo {
  ok: boolean;
  mt5Connected: boolean;
  broker?: string;
  server?: string;
  login?: number | null;
  balance?: number | null;
  currency?: string;
  terminal?: string;
  error?: string;
}

export interface Mt5SymbolInfo {
  name: string;
  description: string;
  digits: number;
  visible: boolean;
  path: string;
}

import { Moon, RefreshCw, Sun, Upload } from 'lucide-react';
import {
  ConfluenceMode,
  DataSourceMode,
  ProfileMode,
  TIMEFRAMES,
  Timeframe,
} from '../types/scalp';

interface WorkspaceToolbarProps {
  timeframe: Timeframe;
  onChangeTimeframe: (tf: Timeframe) => void;
  profile: ProfileMode;
  onChangeProfile: (p: ProfileMode) => void;
  confMode: ConfluenceMode;
  onChangeConfMode: (m: ConfluenceMode) => void;
  dataSource: DataSourceMode;
  onChangeDataSource: (s: DataSourceMode) => void;
  refreshIntervalSec: number;
  onChangeRefreshInterval: (sec: number) => void;
  isRefreshing: boolean;
  onRefreshNow: () => void;
  onOpenCsvPicker: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  mt5Connected: boolean;
}

export function WorkspaceToolbar({
  timeframe,
  onChangeTimeframe,
  profile,
  onChangeProfile,
  confMode,
  onChangeConfMode,
  dataSource,
  onChangeDataSource,
  refreshIntervalSec,
  onChangeRefreshInterval,
  isRefreshing,
  onRefreshNow,
  onOpenCsvPicker,
  darkMode,
  onToggleDarkMode,
  mt5Connected,
}: WorkspaceToolbarProps) {
  return (
    <div className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/80 dark:bg-[#0D131D]">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Sélecteur Timeframe */}
          <div
            role="group"
            aria-label="Sélection du timeframe"
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/80 dark:bg-slate-900 border border-slate-300/70 dark:border-slate-800"
          >
            {TIMEFRAMES.map((tf) => {
              const active = timeframe === tf;
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onChangeTimeframe(tf)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              );
            })}
          </div>

          {/* Profil de paramètres */}
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap">Profil</span>
            <select
              value={profile}
              onChange={(e) => onChangeProfile(e.target.value as ProfileMode)}
              className="h-8 px-2.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="Auto (Timeframe)">Auto (TF)</option>
              <option value="M1">M1 (30s/1M)</option>
              <option value="M3/M5">M3/M5 (3M–15M)</option>
              <option value="Custom">Custom</option>
            </select>
          </label>

          {/* Confluence */}
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap">Confluence</span>
            <select
              value={confMode}
              onChange={(e) => onChangeConfMode(e.target.value as ConfluenceMode)}
              className="h-8 px-2.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="Souple (≥1 filtre)">Souple (≥1 filtre)</option>
              <option value="Stricte (2 filtres)">Stricte (2 filtres)</option>
              <option value="UT Bot seul">UT Bot seul</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Source des données */}
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap">Source</span>
            <select
              value={dataSource}
              onChange={(e) => onChangeDataSource(e.target.value as DataSourceMode)}
              className="h-8 px-2.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="auto">
                {mt5Connected ? 'Auto (MT5 Exness connecté)' : 'Auto (MT5 Local → Public)'}
              </option>
              <option value="mt5">MT5 Exness Local (127.0.0.1:8765)</option>
              <option value="public">Flux Public (Yahoo / Binance)</option>
              <option value="csv">Import CSV MT5</option>
            </select>
          </label>

          {/* Intervalle de rafraîchissement */}
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap">Auto</span>
            <select
              value={refreshIntervalSec}
              onChange={(e) => onChangeRefreshInterval(Number(e.target.value))}
              className="h-8 px-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value={0}>OFF</option>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={15}>15s</option>
              <option value={30}>30s</option>
            </select>
          </label>

          <button
            type="button"
            onClick={onOpenCsvPicker}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>CSV MT5</span>
          </button>

          <button
            type="button"
            onClick={onRefreshNow}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Actualiser</span>
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Passer en mode clair' : 'Passer en mode sombre'}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  LineChart,
  Minus,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { formatPrice } from '../engine/scalpFusion';
import {
  EffectiveParams,
  PairFeedState,
  Timeframe,
} from '../types/scalp';

interface ScannerViewProps {
  pairs: string[];
  feeds: Record<string, PairFeedState>;
  timeframe: Timeframe;
  effectiveParams: EffectiveParams;
  mt5Connected: boolean;
  onAddPair: (symbol: string) => void;
  onRemovePair: (symbol: string) => void;
  onOpenChart: (symbol: string) => void;
  onOpenLocalSetup: () => void;
  onOpenCsvPickerForPair: (symbol: string) => void;
}

export function ScannerView({
  pairs,
  feeds,
  timeframe,
  effectiveParams,
  mt5Connected,
  onAddPair,
  onRemovePair,
  onOpenChart,
  onOpenLocalSetup,
  onOpenCsvPickerForPair,
}: ScannerViewProps) {
  const [filterText, setFilterText] = useState('');
  const [quickSymbol, setQuickSymbol] = useState('');
  const [signalFilter, setSignalFilter] = useState<'ALL' | 'SIGNALS' | 'VETO'>('ALL');

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const s = quickSymbol.trim();
    if (!s) return;
    onAddPair(s);
    setQuickSymbol('');
  };

  const rows = pairs.map((sym) => ({
    symbol: sym,
    feed: feeds[sym],
  }));

  const activeSignalsCount = rows.filter((r) => {
    const st = r.feed?.computed?.summary?.signalState;
    return st === 'ACHAT' || st === 'VENTE';
  }).length;

  const vetoCount = rows.filter((r) => {
    const st = r.feed?.computed?.summary?.signalState;
    return st === 'VETO_RES' || st === 'VETO_SUP';
  }).length;

  const activeSourceLabel = (() => {
    if (mt5Connected) return 'MT5 Exness Local';
    const firstWithSource = rows.find((r) => r.feed && !r.feed.error && r.feed.source);
    return firstWithSource?.feed?.source || 'En attente de flux';
  })();

  const filteredRows = rows.filter(({ symbol, feed }) => {
    if (filterText.trim() && !symbol.toUpperCase().includes(filterText.trim().toUpperCase())) {
      return false;
    }
    const st = feed?.computed?.summary?.signalState;
    if (signalFilter === 'SIGNALS') return st === 'ACHAT' || st === 'VENTE';
    if (signalFilter === 'VETO') return st === 'VETO_RES' || st === 'VETO_SUP';
    return true;
  });

  const formatTimestamp = (ts: number | null | undefined) => {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: timeframe === '30s' ? '2-digit' : undefined,
    });
  };

  return (
    <div className="space-y-5">
      {/* Bandeau résumé 4 colonnes sans imbrication de cartes */}
      <section
        aria-label="Résumé du scanner"
        className="rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800"
      >
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Paires surveillées
          </div>
          <div className="mt-1 text-2xl font-display font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {pairs.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Timeframe {timeframe} · Profil {effectiveParams.profileLabel}
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Signaux finaux actifs
          </div>
          <div className="mt-1 text-2xl font-display font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {activeSignalsCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {vetoCount} bloqué{vetoCount > 1 ? 's' : ''} par veto S/R
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Paramètres effectifs
          </div>
          <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            UT {effectiveParams.kvEff} / {effectiveParams.atrEff} · EMA {effectiveParams.fastLen}/{effectiveParams.medLen}
          </div>
          <div className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400">
            PAC {effectiveParams.pacLen} · LRC {effectiveParams.lrLen}/{effectiveParams.sigLen} · BO {effectiveParams.boPerc}%
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Source de marché active
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {mt5Connected && (
              <span
                className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
                aria-label="Connecté"
              />
            )}
            <span className="truncate">{activeSourceLabel}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {mt5Connected ? (
              'Flux Exness temps réel sur 127.0.0.1:8765'
            ) : (
              <button
                type="button"
                onClick={onOpenLocalSetup}
                className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Connecter le script Python MT5 local
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Barre d'actions du tableau : recherche, filtres, ajout rapide */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filtrer les paires..."
              className="h-9 w-48 pl-8 pr-3 text-xs rounded-lg bg-white dark:bg-[#121924] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div
            role="group"
            aria-label="Filtrer par état de signal"
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-300/60 dark:border-slate-800"
          >
            {(
              [
                { id: 'ALL', label: 'Toutes' },
                { id: 'SIGNALS', label: 'Signaux Achat/Vente' },
                { id: 'VETO', label: 'Veto S/R' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSignalFilter(opt.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  signalFilter === opt.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleQuickAdd} className="flex items-center gap-2">
          <input
            type="text"
            value={quickSymbol}
            onChange={(e) => setQuickSymbol(e.target.value)}
            placeholder="Ajouter (ex: XAUUSDm)"
            className="h-9 w-44 px-3 text-xs font-mono rounded-lg bg-white dark:bg-[#121924] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="submit"
            disabled={!quickSymbol.trim()}
            className="inline-flex items-center gap-1 h-9 px-3.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Ajouter</span>
          </button>
        </form>
      </div>

      {/* Tableau principal du Scanner */}
      {pairs.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 px-6 py-14 text-center">
          <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Aucune paire dans votre liste de surveillance
          </h3>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Ajoutez vos symboles Exness (par exemple EURUSDm, XAUUSDm, GBPUSDm) pour démarrer l’analyse SCALP FUSION sur {timeframe}.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0F1622] text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 whitespace-nowrap">Paire</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Prix</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Signal final</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">UT Bot / Stop</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">SCALPTOOL</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">LRC</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">S/R &amp; Veto</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Breakout Prob.</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Dernier flip</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                {filteredRows.map(({ symbol, feed }) => {
                  const summary = feed?.computed?.summary;
                  const loading = feed?.loading && !summary;
                  const err = feed?.error;

                  return (
                    <tr
                      key={symbol}
                      onClick={() => {
                        if (summary) onOpenChart(symbol);
                      }}
                      className={`h-11 transition-colors ${
                        summary
                          ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer'
                          : ''
                      }`}
                    >
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {symbol}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {feed?.resolvedSymbol && feed.resolvedSymbol !== symbol
                            ? `${feed.resolvedSymbol} · ${timeframe}`
                            : `${timeframe} · ${feed?.source || 'En attente'}`}
                        </div>
                      </td>

                      {loading ? (
                        <td colSpan={8} className="py-2.5 px-3">
                          <div className="h-4 w-full max-w-md rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                        </td>
                      ) : err && !summary ? (
                        <td colSpan={8} className="py-2.5 px-3 text-amber-600 dark:text-amber-400">
                          <div className="flex flex-wrap items-center gap-3">
                            <span>{err}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenLocalSetup();
                              }}
                              className="text-blue-600 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                            >
                              Configurer MT5 Local
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenCsvPickerForPair(symbol);
                              }}
                              className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:underline cursor-pointer"
                            >
                              <Upload className="w-3 h-3" />
                              Importer CSV
                            </button>
                          </div>
                        </td>
                      ) : summary ? (
                        <>
                          {/* Prix */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono tabular-nums">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatPrice(summary.price, symbol)}
                            </div>
                            <div
                              className={`text-[11px] ${
                                summary.changePct >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {summary.changePct >= 0 ? '+' : ''}
                              {summary.changePct.toFixed(3)}%
                            </div>
                          </td>

                          {/* Signal Final */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-semibold">
                            {summary.signalState === 'ACHAT' && (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                                ACHAT
                              </span>
                            )}
                            {summary.signalState === 'VENTE' && (
                              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                                <ArrowDownRight className="w-3.5 h-3.5" aria-hidden="true" />
                                VENTE
                              </span>
                            )}
                            {(summary.signalState === 'VETO_RES' ||
                              summary.signalState === 'VETO_SUP') && (
                              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                                {summary.signalState === 'VETO_RES'
                                  ? 'BLOQUÉ RÉS.'
                                  : 'BLOQUÉ SUP.'}
                              </span>
                            )}
                            {summary.signalState === 'ATTENTE' && (
                              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 font-normal">
                                <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                                Attente
                              </span>
                            )}
                          </td>

                          {/* UT Bot */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums">
                            <div
                              className={
                                summary.utPos === 1
                                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                  : summary.utPos === -1
                                  ? 'text-rose-600 dark:text-rose-400 font-medium'
                                  : 'text-slate-500'
                              }
                            >
                              {summary.utPos === 1 ? 'LONG' : summary.utPos === -1 ? 'SHORT' : 'NEUTRE'}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              SL {formatPrice(summary.utStop, symbol)}
                            </div>
                          </td>

                          {/* SCALPTOOL */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {summary.trendDir === 1 && (
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                Haussier (+1)
                              </span>
                            )}
                            {summary.trendDir === -1 && (
                              <span className="font-medium text-rose-600 dark:text-rose-400">
                                Baissier (-1)
                              </span>
                            )}
                            {summary.trendDir === 0 && (
                              <span className="text-slate-500 dark:text-slate-400">
                                Consolidation (0)
                              </span>
                            )}
                          </td>

                          {/* LRC */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`font-medium ${
                                summary.lrcBull
                                  ? 'text-sky-600 dark:text-sky-400'
                                  : 'text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {summary.lrcBull ? 'Haussier' : 'Baissier'}
                            </span>
                          </td>

                          {/* S/R & Veto */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums">
                            <div className="text-[11px] text-slate-700 dark:text-slate-300">
                              R {formatPrice(summary.srRes, symbol)} · S{' '}
                              {formatPrice(summary.srSup, symbol)}
                            </div>
                            <div
                              className={`text-[11px] ${
                                summary.resTooClose || summary.supTooClose
                                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {summary.resTooClose
                                ? 'Veto Résistance proche'
                                : summary.supTooClose
                                ? 'Veto Support proche'
                                : 'Passage libre'}
                            </div>
                          </td>

                          {/* Breakout Prob */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono tabular-nums">
                            <div className="text-slate-900 dark:text-slate-100">
                              ↑{summary.boUpProb.toFixed(0)}% / ↓{summary.boDnProb.toFixed(0)}%
                            </div>
                            <div
                              className={`text-[11px] ${
                                summary.boBullBias
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              Biais {summary.boBullBias ? 'Hausse' : 'Baisse'}
                            </div>
                          </td>

                          {/* Dernier signal */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono tabular-nums">
                            {summary.lastFinalSignal ? (
                              <>
                                <div
                                  className={
                                    summary.lastFinalSignal === 'ACHAT'
                                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                      : 'text-rose-600 dark:text-rose-400 font-semibold'
                                  }
                                >
                                  {summary.lastFinalSignal}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {formatTimestamp(summary.lastFinalTime)}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <td colSpan={8} className="py-2.5 px-3 text-slate-400">
                          Aucune donnée chargée
                        </td>
                      )}

                      {/* Actions */}
                      <td
                        className="py-2.5 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenChart(symbol)}
                            title="Ouvrir le graphique"
                            aria-label={`Ouvrir le graphique ${symbol}`}
                            className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <LineChart className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemovePair(symbol)}
                            title="Supprimer la paire"
                            aria-label={`Supprimer ${symbol}`}
                            className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

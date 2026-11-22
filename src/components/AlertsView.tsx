import { useState } from 'react';
import { Download, Trash2, Volume2, VolumeX } from 'lucide-react';
import { formatPrice } from '../engine/scalpFusion';
import { AlertLogEntry } from '../types/scalp';

interface AlertsViewProps {
  alerts: AlertLogEntry[];
  soundEnabled: boolean;
  onToggleSound: () => void;
  onClearAlerts: () => void;
  onOpenChart: (symbol: string) => void;
}

export function AlertsView({
  alerts,
  soundEnabled,
  onToggleSound,
  onClearAlerts,
  onOpenChart,
}: AlertsViewProps) {
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SIGNALS' | 'BREAKS' | 'STC'>('ALL');

  const filtered = alerts.filter((a) => {
    if (typeFilter === 'SIGNALS') return a.type === 'ACHAT' || a.type === 'VENTE';
    if (typeFilter === 'BREAKS') return a.type === 'CASSURE_RES' || a.type === 'CASSURE_SUP';
    if (typeFilter === 'STC') return a.type === 'STC_VERT' || a.type === 'STC_ROUGE';
    return true;
  });

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const header = 'Horodatage,Paire,Timeframe,Type,Prix,Message,Source\n';
    const rows = filtered
      .map((a) => {
        const dt = new Date(a.barTime * 1000).toISOString();
        return `${dt},${a.symbol},${a.timeframe},${a.type},${a.price},"${a.message.replace(/"/g, '""')}","${a.source}"`;
      })
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scalp_fusion_alertes_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filtrer les alertes"
          className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-300/60 dark:border-slate-800"
        >
          {(
            [
              { id: 'ALL', label: 'Toutes' },
              { id: 'SIGNALS', label: 'Signaux Achat/Vente' },
              { id: 'BREAKS', label: 'Cassures S/R' },
              { id: 'STC', label: 'Alertes STC' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTypeFilter(opt.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                typeFilter === opt.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleSound}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-white dark:bg-[#121924] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{soundEnabled ? 'Son actif' : 'Son coupé'}</span>
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-white dark:bg-[#121924] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exporter CSV</span>
          </button>

          <button
            type="button"
            onClick={onClearAlerts}
            disabled={alerts.length === 0}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-white dark:bg-[#121924] text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-40 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Vider</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 px-6 py-14 text-center">
          <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Aucune alerte enregistrée
          </h3>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Les signaux finaux « SCALP FUSION - ACHAT / VENTE » et les cassures S/R détectés sur vos bougies apparaîtront ici automatiquement.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0F1622] text-slate-500 dark:text-slate-400 font-medium">
                  <th className="py-2.5 px-4 whitespace-nowrap">Heure bougie</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Paire</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">TF</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Événement</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Prix</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Détail</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => onOpenChart(a.symbol)}
                    className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-2 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {new Date(a.barTime * 1000).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: a.timeframe === '30s' ? '2-digit' : undefined,
                      })}
                    </td>
                    <td className="py-2 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {a.symbol}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {a.timeframe}
                    </td>
                    <td
                      className={`py-2 px-3 font-semibold whitespace-nowrap ${
                        a.type === 'ACHAT' || a.type === 'CASSURE_RES' || a.type === 'STC_VERT'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : a.type === 'VETO'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {a.type}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {formatPrice(a.price, a.symbol)}
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                      {a.message}
                    </td>
                    <td className="py-2 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {a.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

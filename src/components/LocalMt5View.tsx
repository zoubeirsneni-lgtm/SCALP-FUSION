import { useState } from 'react';
import { Check, Copy, Download, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { PYTHON_PACK_FILES } from '../pythonPack/packFiles';
import { Mt5HealthInfo, Mt5SymbolInfo } from '../types/scalp';
import { buildZipBlob } from '../utils/zipBuilder';

interface LocalMt5ViewProps {
  bridgeUrl: string;
  onChangeBridgeUrl: (url: string) => void;
  health: Mt5HealthInfo | null;
  checking: boolean;
  onTestConnection: () => void;
  mt5Symbols: Mt5SymbolInfo[];
  onRefreshSymbols: (search: string) => void;
  pairs: string[];
  onAddPair: (sym: string) => void;
  onRemovePair: (sym: string) => void;
}

export function LocalMt5View({
  bridgeUrl,
  onChangeBridgeUrl,
  health,
  checking,
  onTestConnection,
  mt5Symbols,
  onRefreshSymbols,
  pairs,
  onAddPair,
  onRemovePair,
}: LocalMt5ViewProps) {
  const [selectedFile, setSelectedFile] = useState(PYTHON_PACK_FILES[0].name);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [symbolSearch, setSymbolSearch] = useState('');

  const handleDownloadZip = () => {
    const blob = buildZipBlob(
      PYTHON_PACK_FILES.map((f) => ({
        name: `scalp_fusion_mt5_local/${f.name}`,
        content: f.content,
      }))
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'scalp_fusion_mt5_exness_python.zip';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async (name: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedName(name);
      setTimeout(() => setCopiedName(null), 1800);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const activeFile =
    PYTHON_PACK_FILES.find((f) => f.name === selectedFile) ?? PYTHON_PACK_FILES[0];
  const pairSet = new Set(pairs.map((p) => p.toUpperCase()));

  return (
    <div className="space-y-6">
      {/* Bloc 1 : Connexion au pont Python MT5 Exness */}
      <section className="rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Connexion locale MetaTrader 5 (Exness)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Exécutez le script Python local sur votre PC Windows avec MT5 Exness ouvert. Le pont lit directement vos bougies M1/M3/M5/M10/M15 et agrège les ticks en bougies 30s en temps réel.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDownloadZip}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Télécharger le pack Python (.zip)</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <label className="flex-1 min-w-[240px] max-w-md space-y-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Adresse du pont Python local
            </span>
            <input
              type="text"
              value={bridgeUrl}
              onChange={(e) => onChangeBridgeUrl(e.target.value)}
              placeholder="http://127.0.0.1:8765"
              className="w-full h-9 px-3 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </label>

          <div className="pt-5">
            <button
              type="button"
              onClick={onTestConnection}
              disabled={checking}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Tester la connexion MT5</span>
            </button>
          </div>
        </div>

        {/* Statut réel du terminal Exness */}
        <div className="pt-2 text-xs">
          {health?.mt5Connected ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-slate-800 dark:text-slate-200">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Statut terminal</div>
                <div className="mt-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                  Connecté ({health.terminal || 'MT5'})
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Broker / Serveur</div>
                <div className="mt-0.5 font-mono font-medium">
                  {health.broker || 'Exness'} · {health.server || '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Compte MT5</div>
                <div className="mt-0.5 font-mono tabular-nums font-medium">
                  #{health.login ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Solde</div>
                <div className="mt-0.5 font-mono tabular-nums font-semibold">
                  {health.balance !== null && health.balance !== undefined
                    ? `${health.balance.toFixed(2)} ${health.currency || 'USD'}`
                    : '—'}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
              {health?.error
                ? `Pont local non détecté sur ${bridgeUrl} (${health.error}). Téléchargez le pack ci-dessus et double-cliquez sur install_and_run.bat.`
                : `En attente de connexion au pont Python local sur ${bridgeUrl}.`}
            </div>
          )}
        </div>
      </section>

      {/* Bloc 2 : Navigateur de symboles Exness Market Watch (si connecté) */}
      {health?.mt5Connected && (
        <section className="rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                Symboles disponibles dans votre terminal MT5 Exness
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Ajoutez ou retirez directement vos paires Exness dans le scanner.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onRefreshSymbols(symbolSearch);
              }}
              className="flex items-center gap-2"
            >
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={symbolSearch}
                  onChange={(e) => setSymbolSearch(e.target.value)}
                  placeholder="Rechercher EUR, XAU, BTC..."
                  className="h-8 w-52 pl-8 pr-3 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                />
              </div>
              <button
                type="submit"
                className="h-8 px-3 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 cursor-pointer"
              >
                Rechercher
              </button>
            </form>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-60 overflow-y-auto">
            {mt5Symbols.map((sym) => {
              const active = pairSet.has(sym.name.toUpperCase());
              return (
                <div
                  key={sym.name}
                  className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {sym.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {sym.digits} déc.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      active ? onRemovePair(sym.name) : onAddPair(sym.name)
                    }
                    title={active ? 'Retirer' : 'Ajouter'}
                    className={`p-1 rounded transition-colors cursor-pointer ${
                      active
                        ? 'text-rose-600 hover:bg-rose-500/10'
                        : 'text-blue-600 hover:bg-blue-500/10'
                    }`}
                  >
                    {active ? <Trash2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Bloc 3 : Guide rapide + Code source des scripts Python locaux */}
      <section className="rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              Fichiers du pack Python local (dossier python_local/)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              1. Ouvrez MT5 Exness · 2. Décompressez le ZIP · 3. Lancez install_and_run.bat
            </p>
          </div>

          <button
            type="button"
            onClick={() => handleCopy(activeFile.name, activeFile.content)}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            {copiedName === activeFile.name ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span>Copié</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copier {activeFile.name}</span>
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/70">
            {PYTHON_PACK_FILES.map((file) => {
              const active = file.name === activeFile.name;
              return (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => setSelectedFile(file.name)}
                  className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-mono text-xs font-semibold">{file.name}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                    {file.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-9 bg-slate-950 text-slate-200 p-4 overflow-x-auto max-h-[460px]">
            <pre className="text-[11px] font-mono leading-relaxed whitespace-pre">
              {activeFile.content}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
}

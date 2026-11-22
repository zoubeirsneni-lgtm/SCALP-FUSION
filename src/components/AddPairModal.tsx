import { useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { Mt5SymbolInfo } from '../types/scalp';

interface AddPairModalProps {
  open: boolean;
  onClose: () => void;
  existingPairs: string[];
  onAddPair: (symbol: string) => void;
  mt5Symbols: Mt5SymbolInfo[];
}

const EXNESS_PRESETS = [
  'EURUSDm',
  'GBPUSDm',
  'USDJPYm',
  'XAUUSDm',
  'USDCADm',
  'AUDUSDm',
  'EURJPYm',
  'GBPJPYm',
  'NZDUSDm',
  'USDCHFm',
  'BTCUSDm',
  'ETHUSDm',
  'US30m',
  'USTECm',
];

export function AddPairModal({
  open,
  onClose,
  existingPairs,
  onAddPair,
  mt5Symbols,
}: AddPairModalProps) {
  const [input, setInput] = useState('');

  if (!open) return null;

  const trimmed = input.trim();
  const normalizedExisting = new Set(existingPairs.map((p) => p.toUpperCase()));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    onAddPair(trimmed);
    setInput('');
    onClose();
  };

  const filteredMt5 = mt5Symbols
    .filter((s) => {
      if (!trimmed) return true;
      const q = trimmed.toUpperCase();
      return (
        s.name.toUpperCase().includes(q) ||
        s.description.toUpperCase().includes(q)
      );
    })
    .slice(0, 24);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-pair-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-[#121924] border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2
              id="add-pair-title"
              className="text-base font-display font-semibold text-slate-900 dark:text-slate-100"
            >
              Ajouter une paire Exness / MT5
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Utilisez le nom exact de votre Market Watch (ex. EURUSDm, XAUUSDc, BTCUSDm).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ex: EURUSDm, XAUUSDm, GBPJPYm..."
                className="w-full h-10 pl-9 pr-3 text-sm font-mono rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <button
              type="submit"
              disabled={!trimmed}
              className="inline-flex items-center gap-1.5 h-10 px-4 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Ajouter</span>
            </button>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
              {mt5Symbols.length > 0
                ? 'Symboles détectés dans votre Market Watch MT5 Exness'
                : 'Raccourcis paires Exness populaires'}
            </div>

            {mt5Symbols.length > 0 ? (
              <div className="max-h-56 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1.5 pr-1">
                {filteredMt5.map((sym) => {
                  const already = normalizedExisting.has(sym.name.toUpperCase());
                  return (
                    <button
                      key={sym.name}
                      type="button"
                      disabled={already}
                      onClick={() => {
                        onAddPair(sym.name);
                        onClose();
                      }}
                      className={`px-2.5 py-2 text-left rounded-lg border text-xs transition-colors cursor-pointer ${
                        already
                          ? 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 text-slate-400 cursor-not-allowed'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:border-blue-500 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <div className="font-mono font-semibold truncate">{sym.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {already ? 'Déjà suivie' : sym.description || 'MT5 Exness'}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {EXNESS_PRESETS.map((preset) => {
                  const already = normalizedExisting.has(preset.toUpperCase());
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={already}
                      onClick={() => {
                        onAddPair(preset);
                        onClose();
                      }}
                      className={`px-2.5 py-2 rounded-lg border text-xs font-mono font-medium transition-colors cursor-pointer ${
                        already
                          ? 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/40 text-slate-400 cursor-not-allowed'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:border-blue-500 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

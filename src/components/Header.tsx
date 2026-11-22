import { Plus } from 'lucide-react';
import { ActiveTab } from '../types/scalp';

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenAddPair: () => void;
  alertCount: number;
}

export function Header({
  activeTab,
  onSelectTab,
  onOpenAddPair,
  alertCount,
}: HeaderProps) {
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'scanner', label: 'Scanner' },
    { id: 'chart', label: 'Graphique' },
    { id: 'alerts', label: alertCount > 0 ? `Alertes (${alertCount})` : 'Alertes' },
    { id: 'local', label: 'MT5 Local' },
  ];

  return (
    <header className="border-b border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F1622]">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onSelectTab('scanner')}
          className="text-lg font-display font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          SCALP FUSION
        </button>

        <nav
          aria-label="Navigation principale"
          className="flex items-center gap-6 overflow-x-auto"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-4 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  active
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenAddPair}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0F1622]"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Ajouter paire</span>
          </button>
        </div>
      </div>
    </header>
  );
}

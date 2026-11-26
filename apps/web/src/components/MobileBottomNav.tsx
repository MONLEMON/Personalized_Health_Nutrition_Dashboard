import { Calendar, LayoutGrid, Plus, TrendingUp, User } from 'lucide-react';

export type MobileTab = 'dashboard' | 'calendar' | 'trends' | 'profile';

export interface MobileBottomNavProps {
  activeTab: MobileTab;
  onSelectTab: (tab: MobileTab) => void;
  onOpenQuickLog: () => void;
}

interface NavTabItem {
  id: MobileTab;
  label: string;
  icon: typeof LayoutGrid;
}

const LEFT_TABS: NavTabItem[] = [
  { id: 'dashboard', label: 'Today', icon: LayoutGrid },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
];

const RIGHT_TABS: NavTabItem[] = [
  { id: 'trends', label: 'Trends', icon: TrendingUp },
  { id: 'profile', label: 'Profile', icon: User },
];

export function MobileBottomNav({
  activeTab,
  onSelectTab,
  onOpenQuickLog,
}: MobileBottomNavProps) {
  const renderTabButton = (item: NavTabItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectTab(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`relative flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1 text-[10px] font-medium transition active:scale-95 ${
          isActive ? 'text-[#2EE6A6]' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span className="max-w-full truncate">{item.label}</span>
        {isActive ? (
          <span className="h-1 w-1 rounded-full bg-[#2EE6A6]" aria-hidden="true" />
        ) : null}
      </button>
    );
  };

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0D1017]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-center px-1 py-1.5 sm:px-1.5">
        {LEFT_TABS.map(renderTabButton)}

        {/* Prominent Center Quick-Log Action */}
        <div className="flex min-w-0 flex-col items-center justify-center px-1">
          <button
            type="button"
            onClick={onOpenQuickLog}
            aria-label="Quick log meal or workout"
            className="-mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#2EE6A6] text-[#081016] shadow-[0_0_24px_rgba(46,230,166,0.55)] ring-4 ring-[#0A0C10] transition hover:brightness-110 active:scale-95 sm:-mt-5 sm:h-13 sm:w-13"
          >
            <Plus className="h-5 w-5 stroke-[2.75] sm:h-6 sm:w-6" />
          </button>
          <span className="mt-0.5 max-w-full truncate text-[10px] font-semibold text-slate-300">
            Log
          </span>
        </div>

        {RIGHT_TABS.map(renderTabButton)}
      </div>
    </nav>
  );
}

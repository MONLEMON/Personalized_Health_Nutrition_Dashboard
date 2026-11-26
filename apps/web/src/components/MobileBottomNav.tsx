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
        className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 py-1 text-[10px] font-medium transition active:scale-95 ${
          isActive ? 'text-[#2EE6A6]' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Icon className="h-5 w-5" />
        <span>{item.label}</span>
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
      <div className="mx-auto grid max-w-md grid-cols-5 items-center px-1.5 py-1.5">
        {LEFT_TABS.map(renderTabButton)}

        {/* Prominent Center Quick-Log Action */}
        <div className="flex flex-col items-center justify-center">
          <button
            type="button"
            onClick={onOpenQuickLog}
            aria-label="Quick log meal or workout"
            className="-mt-5 flex h-13 w-13 items-center justify-center rounded-full bg-[#2EE6A6] text-[#081016] shadow-[0_0_24px_rgba(46,230,166,0.55)] ring-4 ring-[#0A0C10] transition hover:brightness-110 active:scale-95"
          >
            <Plus className="h-6 w-6 stroke-[2.75]" />
          </button>
          <span className="mt-0.5 text-[10px] font-semibold text-slate-300">Log</span>
        </div>

        {RIGHT_TABS.map(renderTabButton)}
      </div>
    </nav>
  );
}

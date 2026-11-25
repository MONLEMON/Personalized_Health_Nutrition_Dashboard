import { Dumbbell, Plus, Utensils, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface QuickLogFabProps {
  onOpenMealModal: () => void;
  onOpenWorkoutModal: () => void;
}

export function QuickLogFab({ onOpenMealModal, onOpenWorkoutModal }: QuickLogFabProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  const handleMeal = () => {
    setExpanded(false);
    onOpenMealModal();
  };

  const handleWorkout = () => {
    setExpanded(false);
    onOpenWorkoutModal();
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 hidden flex-col items-end gap-2.5 md:flex lg:bottom-7 lg:right-7">
      {expanded && (
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleWorkout}
            className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-[#141720]/90 px-4 py-2.5 text-xs font-semibold text-white shadow-xl backdrop-blur-xl transition hover:border-[#FFB020]/50 hover:bg-[#1B202C]"
          >
            <Dumbbell className="h-4 w-4 text-[#FFB020]" />
            <span>Log Workout</span>
          </button>

          <button
            type="button"
            onClick={handleMeal}
            className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-[#141720]/90 px-4 py-2.5 text-xs font-semibold text-white shadow-xl backdrop-blur-xl transition hover:border-[#2EE6A6]/50 hover:bg-[#1B202C]"
          >
            <Utensils className="h-4 w-4 text-[#2EE6A6]" />
            <span>Log Meal</span>
          </button>
        </div>
      )}

      <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-[#141720]/85 p-1.5 shadow-[0_18px_40px_-10px_rgba(0,0,0,0.85)] backdrop-blur-2xl">
        <button
          type="button"
          onClick={handleMeal}
          className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:inline-flex"
        >
          <Utensils className="h-3.5 w-3.5 text-[#2EE6A6]" />
          Meal
        </button>

        <button
          type="button"
          onClick={handleWorkout}
          className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:inline-flex"
        >
          <Dumbbell className="h-3.5 w-3.5 text-[#FFB020]" />
          Workout
        </button>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Close quick log actions' : 'Open quick log actions'}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#2EE6A6] px-4 text-xs font-bold text-[#081016] shadow-[0_0_24px_-4px_rgba(46,230,166,0.65)] transition hover:brightness-110 active:scale-95"
        >
          {expanded ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4 stroke-[2.5]" />}
          <span className="sm:hidden">Quick Log</span>
        </button>
      </div>
    </div>
  );
}

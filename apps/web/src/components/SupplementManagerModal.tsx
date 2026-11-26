import { useEffect, useState, type FormEvent } from 'react';
import {
  SupplementConfigSchema,
  UpdateSupplementsSchema,
  type SupplementConfig,
} from '@health-dash/shared';
import { AlertCircle, Check, Loader2, Pill, Plus, Sparkles, Trash2, X } from 'lucide-react';

export interface SupplementManagerModalProps {
  isOpen: boolean;
  supplements: SupplementConfig[];
  isSubmitting?: boolean;
  onClose: () => void;
  onSave: (supplements: SupplementConfig[]) => Promise<void>;
}

interface QuickAddPreset {
  chipLabel: string;
  config: SupplementConfig;
}

const QUICK_ADD_VITAMINS: QuickAddPreset[] = [
  {
    chipLabel: 'Vitamin C · 1000mg',
    config: {
      key: 'vitamin_c',
      name: 'Vitamin C',
      dosage: '1000 mg',
      timing: 'With breakfast',
    },
  },
  {
    chipLabel: 'Zinc · 15mg',
    config: {
      key: 'zinc',
      name: 'Zinc',
      dosage: '15 mg',
      timing: 'With dinner',
    },
  },
  {
    chipLabel: 'Vitamin B-Complex · 1 cap',
    config: {
      key: 'vit_b_complex',
      name: 'Vitamin B-Complex',
      dosage: '1 cap',
      timing: 'Morning',
    },
  },
  {
    chipLabel: 'Probiotics · 1 cap',
    config: {
      key: 'probiotics',
      name: 'Probiotics',
      dosage: '1 cap',
      timing: 'Before breakfast',
    },
  },
  {
    chipLabel: 'Electrolytes · 1 scoop',
    config: {
      key: 'electrolytes',
      name: 'Electrolytes',
      dosage: '1 scoop',
      timing: 'Intra-workout',
    },
  },
  {
    chipLabel: 'Collagen · 10g',
    config: {
      key: 'collagen',
      name: 'Collagen',
      dosage: '10 g',
      timing: 'Post-workout',
    },
  },
];

function generateUniqueSupplementKey(name: string, existingKeys: Set<string>): string {
  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 52);
  const seed = baseSlug.length > 0 ? baseSlug : 'supplement';
  if (!existingKeys.has(seed)) {
    return seed;
  }
  let counter = 2;
  while (existingKeys.has(`${seed}_${counter}`)) {
    counter += 1;
  }
  return `${seed}_${counter}`.slice(0, 64);
}

export function SupplementManagerModal({
  isOpen,
  supplements,
  isSubmitting = false,
  onClose,
  onSave,
}: SupplementManagerModalProps) {
  const [drafts, setDrafts] = useState<SupplementConfig[]>([]);
  const [newName, setNewName] = useState('');
  const [newDosage, setNewDosage] = useState('');
  const [newTiming, setNewTiming] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [localSubmitting, setLocalSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDrafts(supplements.map((item) => ({ ...item })));
      setNewName('');
      setNewDosage('');
      setNewTiming('');
      setError(null);
    }
  }, [isOpen, supplements]);

  const busy = isSubmitting || localSubmitting;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const existingKeys = new Set(drafts.map((item) => item.key));

  const handleUpdateItem = (
    key: string,
    field: 'name' | 'dosage' | 'timing',
    value: string,
  ) => {
    setError(null);
    setDrafts((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    );
  };

  const handleRemoveItem = (key: string) => {
    setError(null);
    setDrafts((prev) => prev.filter((item) => item.key !== key));
  };

  const handleQuickAdd = (preset: QuickAddPreset) => {
    setError(null);
    const alreadyExists = drafts.some(
      (item) =>
        item.key === preset.config.key ||
        item.name.trim().toLowerCase() === preset.config.name.toLowerCase(),
    );
    if (alreadyExists) {
      return;
    }
    if (drafts.length >= 30) {
      setError('Maximum 30 supplements allowed in your stack.');
      return;
    }
    const key = existingKeys.has(preset.config.key)
      ? generateUniqueSupplementKey(preset.config.name, existingKeys)
      : preset.config.key;
    setDrafts((prev) => [...prev, { ...preset.config, key }]);
  };

  const handleAddCustom = () => {
    setError(null);
    if (drafts.length >= 30) {
      setError('Maximum 30 supplements allowed in your stack.');
      return;
    }

    const trimmedName = newName.trim();
    const trimmedDosage = newDosage.trim();
    const trimmedTiming = newTiming.trim() || 'Daily';
    const key = generateUniqueSupplementKey(trimmedName, existingKeys);

    const parsed = SupplementConfigSchema.safeParse({
      key,
      name: trimmedName,
      dosage: trimmedDosage,
      timing: trimmedTiming,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please enter supplement name and dosage.');
      return;
    }

    setDrafts((prev) => [...prev, parsed.data]);
    setNewName('');
    setNewDosage('');
    setNewTiming('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const sanitized = drafts.map((item) => ({
      key: item.key.trim(),
      name: item.name.trim(),
      dosage: item.dosage.trim(),
      timing: item.timing.trim(),
    }));

    const parsed = UpdateSupplementsSchema.safeParse({ supplements: sanitized });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? 'Please check all supplement fields before saving.',
      );
      return;
    }

    try {
      setLocalSubmitting(true);
      await onSave(parsed.data.supplements);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save supplement stack.');
    } finally {
      setLocalSubmitting(false);
    }
  };

  const inputClasses =
    'min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2 text-base sm:text-sm text-white placeholder:text-slate-500 focus:border-[#2EE6A6]/60 focus:outline-none focus:ring-1 focus:ring-[#2EE6A6]/40';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="supplement-manager-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div className="animate-sheet-up relative max-h-[92dvh] w-full overflow-x-hidden overflow-y-auto rounded-t-3xl rounded-b-none border-t border-x border-white/10 bg-[#141720]/98 px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-2xl sm:rounded-3xl sm:border sm:p-6 sm:shadow-[0_32px_80px_-16px_rgba(0,0,0,0.95)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
        />
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/20 sm:hidden"
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#2EE6A6]/15 text-[#2EE6A6]">
              <Pill className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 id="supplement-manager-title" className="text-base font-semibold text-white">
                Manage Supplement Stack
              </h2>
              <p className="text-xs text-slate-400">
                Adjust dosages, add vitamins, or customize timing
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close supplement manager"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 min-w-0 space-y-4">
          {/* Quick-Add Vitamin Chips */}
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <Sparkles className="h-3 w-3 shrink-0 text-[#2EE6A6]" />
              <span>Quick-Add Vitamins &amp; Essentials</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_ADD_VITAMINS.map((preset) => {
                const isAdded = drafts.some(
                  (item) =>
                    item.key === preset.config.key ||
                    item.name.trim().toLowerCase() === preset.config.name.toLowerCase(),
                );
                return (
                  <button
                    key={preset.config.key}
                    type="button"
                    disabled={isAdded || busy}
                    onClick={() => handleQuickAdd(preset)}
                    className={`inline-flex min-h-[38px] max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      isAdded
                        ? 'border-[#2EE6A6]/35 bg-[#2EE6A6]/12 text-[#2EE6A6] opacity-80'
                        : 'border-white/10 bg-white/[0.04] text-slate-200 hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6]'
                    }`}
                  >
                    {isAdded ? (
                      <Check className="h-3 w-3 shrink-0 text-[#2EE6A6]" />
                    ) : (
                      <Plus className="h-3 w-3 shrink-0 text-[#2EE6A6]" />
                    )}
                    <span className="truncate">{preset.chipLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Stack Inline Editor */}
          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wider text-slate-400">
                Your Stack ({drafts.length}/30)
              </span>
              <span className="text-[11px] text-slate-500">
                Existing keys stay linked to today&apos;s checkmarks
              </span>
            </div>

            {drafts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-[#0F131C]/60 px-4 py-6 text-center text-xs text-slate-400">
                Your supplement stack is empty. Tap a quick-add vitamin above or add a custom item
                below.
              </div>
            ) : (
              <div className="max-h-[34dvh] space-y-2.5 overflow-y-auto pr-1">
                {drafts.map((item) => (
                  <div
                    key={item.key}
                    className="min-w-0 rounded-2xl border border-white/10 bg-[#0F131C]/85 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-slate-400">
                        key: {item.key}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRemoveItem(item.key)}
                        aria-label={`Remove ${item.name || item.key}`}
                        className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#FF5C6C]/15 hover:text-[#FF5C6C]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                      <div className="min-w-0 sm:col-span-5">
                        <label className="mb-1 block text-[11px] text-slate-400">Name</label>
                        <input
                          type="text"
                          required
                          maxLength={80}
                          value={item.name}
                          onChange={(e) => handleUpdateItem(item.key, 'name', e.target.value)}
                          placeholder="Supplement name"
                          className={inputClasses}
                        />
                      </div>
                      <div className="min-w-0 sm:col-span-3">
                        <label className="mb-1 block text-[11px] text-slate-400">Dosage</label>
                        <input
                          type="text"
                          required
                          maxLength={60}
                          value={item.dosage}
                          onChange={(e) => handleUpdateItem(item.key, 'dosage', e.target.value)}
                          placeholder="10 g"
                          className={inputClasses}
                        />
                      </div>
                      <div className="min-w-0 sm:col-span-4">
                        <label className="mb-1 block text-[11px] text-slate-400">Timing</label>
                        <input
                          type="text"
                          required
                          maxLength={60}
                          value={item.timing}
                          onChange={(e) => handleUpdateItem(item.key, 'timing', e.target.value)}
                          placeholder="Post-workout"
                          className={inputClasses}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Custom Supplement */}
          <div className="min-w-0 rounded-2xl border border-white/10 bg-[#0A0C10]/70 p-3.5">
            <div className="mb-2.5 text-xs font-semibold text-slate-300">
              Add Custom Supplement
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              <div className="min-w-0 sm:col-span-5">
                <input
                  type="text"
                  maxLength={80}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Ashwagandha KSM-66"
                  className={inputClasses}
                />
              </div>
              <div className="min-w-0 sm:col-span-3">
                <input
                  type="text"
                  maxLength={60}
                  value={newDosage}
                  onChange={(e) => setNewDosage(e.target.value)}
                  placeholder="600 mg"
                  className={inputClasses}
                />
              </div>
              <div className="min-w-0 sm:col-span-4">
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    type="text"
                    maxLength={60}
                    value={newTiming}
                    onChange={(e) => setNewTiming(e.target.value)}
                    placeholder="Before sleep"
                    className={`min-w-0 flex-1 ${inputClasses}`}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleAddCustom}
                    className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1 rounded-xl border border-[#2EE6A6]/40 bg-[#2EE6A6]/15 px-3.5 text-xs font-semibold text-[#2EE6A6] transition hover:bg-[#2EE6A6]/25 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl border border-[#FF5C6C]/35 bg-[#FF5C6C]/12 px-3.5 py-2.5 text-xs font-medium text-[#FF8A95]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5C6C]" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50 sm:flex-none sm:text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-5 py-2.5 text-sm font-bold text-[#081016] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 sm:flex-none sm:text-xs"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span>Save Stack</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import {
  CreateBatchNutritionLogsSchema,
  createNutritionLogSchema,
  createWorkoutLogSchema,
  type BatchNutritionLogItemInput,
  type CreateBatchNutritionLogsInput,
  type CreateNutritionLogInput,
  type CreateWorkoutLogInput,
  type NutritionConfidence,
  type ParsedFoodItem,
  type WorkoutCategory,
  type WorkoutIntensity,
} from '@health-dash/shared';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
  Dumbbell,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { ApiError, parseNutritionWithAI } from '../lib/api';
import { resizeImageForUpload, type ResizedImageResult } from '../lib/imageResize';

export type QuickLogTab = 'ai' | 'meal' | 'workout';

export interface QuickLogModalProps {
  isOpen: boolean;
  initialTab?: QuickLogTab;
  onClose: () => void;
  onSubmitMeal: (input: CreateNutritionLogInput) => Promise<void>;
  onSubmitMealsBatch?: (input: CreateBatchNutritionLogsInput) => Promise<void>;
  onSubmitWorkout: (input: CreateWorkoutLogInput) => Promise<void>;
  isSubmitting?: boolean;
}

interface MealPreset {
  label: string;
  data: Omit<CreateNutritionLogInput, 'loggedDate'>;
}

interface WorkoutPreset {
  label: string;
  data: Omit<CreateWorkoutLogInput, 'loggedDate'>;
}

interface DraftNutritionItem {
  id: string;
  foodName: string;
  portionDesc: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  confidence: NutritionConfidence;
}

const AI_SAMPLE_PROMPTS: string[] = [
  'ข้าวสวย 200g อกไก่ย่าง ไข่ต้ม 2 ฟอง',
  'กะเพราหมูสับ ไข่ดาว',
  'Whey Isolate 1 scoop + กล้วย 1 ลูก',
];

const CONFIDENCE_BADGE: Record<NutritionConfidence, { label: string; classes: string }> = {
  HIGH: {
    label: 'HIGH',
    classes: 'border-[#2EE6A6]/35 bg-[#2EE6A6]/12 text-[#2EE6A6]',
  },
  MEDIUM: {
    label: 'MEDIUM',
    classes: 'border-[#FFB020]/35 bg-[#FFB020]/12 text-[#FFB020]',
  },
  LOW: {
    label: 'LOW',
    classes: 'border-[#FF5C6C]/35 bg-[#FF5C6C]/12 text-[#FF5C6C]',
  },
};

const MEAL_PRESETS: MealPreset[] = [
  {
    label: 'Chicken Breast Bowl',
    data: {
      itemName: 'Chicken Breast Rice Bowl',
      mealType: 'lunch',
      calories: 560,
      proteinG: 52,
      carbsG: 58,
      fatG: 13,
    },
  },
  {
    label: 'Whey Shake',
    data: {
      itemName: 'Whey Isolate Protein Shake',
      mealType: 'snack',
      calories: 150,
      proteinG: 28,
      carbsG: 4,
      fatG: 2,
    },
  },
  {
    label: 'Greek Yogurt',
    data: {
      itemName: 'Greek Yogurt & Berries',
      mealType: 'breakfast',
      calories: 240,
      proteinG: 22,
      carbsG: 26,
      fatG: 5,
    },
  },
  {
    label: 'Salmon & Rice',
    data: {
      itemName: 'Grilled Salmon & Jasmine Rice',
      mealType: 'dinner',
      calories: 640,
      proteinG: 44,
      carbsG: 62,
      fatG: 22,
    },
  },
];

const WORKOUT_PRESETS: WorkoutPreset[] = [
  {
    label: 'Push Day',
    data: {
      activityName: 'Push Day Hypertrophy',
      category: 'strength',
      durationMin: 55,
      activeCalories: 310,
      intensity: 'high',
    },
  },
  {
    label: 'Zone 2 Run',
    data: {
      activityName: 'Zone 2 Endurance Run',
      category: 'cardio',
      durationMin: 35,
      activeCalories: 320,
      intensity: 'moderate',
    },
  },
  {
    label: 'HIIT',
    data: {
      activityName: 'HIIT Metabolic Conditioning',
      category: 'hiit',
      durationMin: 25,
      activeCalories: 340,
      intensity: 'high',
    },
  },
  {
    label: 'Mobility',
    data: {
      activityName: 'Active Mobility & Core',
      category: 'mobility',
      durationMin: 20,
      activeCalories: 85,
      intensity: 'low',
    },
  },
];

const DEFAULT_MEAL_FORM = {
  itemName: '',
  mealType: 'lunch' as CreateNutritionLogInput['mealType'],
  calories: '450',
  proteinG: '35',
  carbsG: '45',
  fatG: '12',
};

const DEFAULT_WORKOUT_FORM = {
  activityName: '',
  category: 'strength' as WorkoutCategory,
  durationMin: '45',
  activeCalories: '280',
  intensity: 'moderate' as WorkoutIntensity,
};

function formatFileSizeKb(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function createDraftId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDraftItem(item: ParsedFoodItem): DraftNutritionItem {
  return {
    id: createDraftId(),
    foodName: item.food_name,
    portionDesc: item.portion_desc,
    calories: String(Math.round(item.calories)),
    proteinG: String(Math.round(item.protein_g * 10) / 10),
    carbsG: String(Math.round(item.carbs_g * 10) / 10),
    fatG: String(Math.round(item.fat_g * 10) / 10),
    confidence: item.confidence,
  };
}

function createBlankDraftItem(): DraftNutritionItem {
  return {
    id: createDraftId(),
    foodName: '',
    portionDesc: 'Custom portion',
    calories: '0',
    proteinG: '0',
    carbsG: '0',
    fatG: '0',
    confidence: 'MEDIUM',
  };
}

function parseNumericDraftField(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  return Number(trimmed);
}

export function QuickLogModal({
  isOpen,
  initialTab = 'ai',
  onClose,
  onSubmitMeal,
  onSubmitMealsBatch,
  onSubmitWorkout,
  isSubmitting = false,
}: QuickLogModalProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const analysisSeqRef = useRef(0);

  const [activeTab, setActiveTab] = useState<QuickLogTab>(initialTab);
  const [mealForm, setMealForm] = useState(DEFAULT_MEAL_FORM);
  const [workoutForm, setWorkoutForm] = useState(DEFAULT_WORKOUT_FORM);

  // AI Smart Log states
  const [aiStep, setAiStep] = useState<'input' | 'preview'>('input');
  const [aiText, setAiText] = useState('');
  const [resizedImage, setResizedImage] = useState<ResizedImageResult | null>(null);
  const [resizingImage, setResizingImage] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiMealType, setAiMealType] = useState<BatchNutritionLogItemInput['mealType']>('lunch');
  const [draftItems, setDraftItems] = useState<DraftNutritionItem[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [localSubmitting, setLocalSubmitting] = useState(false);

  const replaceResizedImage = useCallback((next: ResizedImageResult | null) => {
    if (previewUrlRef.current && previewUrlRef.current !== next?.previewUrl) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = next?.previewUrl ?? null;
    setResizedImage(next);
  }, []);

  const resetAiFlow = useCallback(() => {
    analysisSeqRef.current += 1;
    setAiStep('input');
    setAiText('');
    setAnalyzing(false);
    setResizingImage(false);
    setAiMealType('lunch');
    setDraftItems([]);
    replaceResizedImage(null);
  }, [replaceResizedImage]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setError(null);
    } else {
      resetAiFlow();
    }
  }, [isOpen, initialTab, resetAiFlow]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !localSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, localSubmitting, onClose]);

  const draftTotals = useMemo(() => {
    return draftItems.reduce(
      (acc, item) => {
        const cal = Number(item.calories) || 0;
        const p = Number(item.proteinG) || 0;
        const c = Number(item.carbsG) || 0;
        const f = Number(item.fatG) || 0;
        return {
          calories: acc.calories + Math.max(0, cal),
          proteinG: acc.proteinG + Math.max(0, p),
          carbsG: acc.carbsG + Math.max(0, c),
          fatG: acc.fatG + Math.max(0, f),
        };
      },
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );
  }, [draftItems]);

  if (!isOpen) return null;

  const busy = isSubmitting || localSubmitting;

  const applyMealPreset = (preset: MealPreset) => {
    setError(null);
    setMealForm({
      itemName: preset.data.itemName,
      mealType: preset.data.mealType,
      calories: String(preset.data.calories),
      proteinG: String(preset.data.proteinG),
      carbsG: String(preset.data.carbsG),
      fatG: String(preset.data.fatG),
    });
  };

  const applyWorkoutPreset = (preset: WorkoutPreset) => {
    setError(null);
    setWorkoutForm({
      activityName: preset.data.activityName,
      category: preset.data.category,
      durationMin: String(preset.data.durationMin),
      activeCalories: String(preset.data.activeCalories),
      intensity: preset.data.intensity,
    });
  };

  const handleImageSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    // Reset input so choosing the same image again still triggers onChange
    e.target.value = '';
    if (!selectedFile) return;

    setError(null);
    setResizingImage(true);
    try {
      const resized = await resizeImageForUpload(selectedFile, 1024, 0.8);
      replaceResizedImage(resized);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not process the selected photo. Please try another image.',
      );
    } finally {
      setResizingImage(false);
    }
  };

  const handleAnalyzeWithAI = async () => {
    const trimmed = aiText.trim();
    if (!trimmed && !resizedImage) {
      setError('Enter a meal description or upload a food photo to analyze.');
      return;
    }

    const requestId = ++analysisSeqRef.current;
    setError(null);
    setAnalyzing(true);

    try {
      const result = await parseNutritionWithAI({
        text: trimmed || undefined,
        image: resizedImage?.file,
      });

      if (analysisSeqRef.current !== requestId) return;

      setAiMealType(result.suggested_meal_type);
      setDraftItems(result.items.map(toDraftItem));
      setAiStep('preview');
    } catch (err) {
      if (analysisSeqRef.current !== requestId) return;

      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(
          err.message.toLowerCase().includes('fetch')
            ? 'Unable to reach the AI nutrition parser right now. Check your connection or switch to Manual mode.'
            : err.message,
        );
      } else {
        setError('AI nutrition analysis failed. Try again or switch to Manual mode.');
      }
    } finally {
      if (analysisSeqRef.current === requestId) {
        setAnalyzing(false);
      }
    }
  };

  const handleUpdateDraftItem = (
    id: string,
    field: keyof Omit<DraftNutritionItem, 'id' | 'confidence'>,
    value: string,
  ) => {
    setDraftItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const handleDeleteDraftItem = (id: string) => {
    setDraftItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddBlankItem = () => {
    setError(null);
    setDraftItems((prev) => [...prev, createBlankDraftItem()]);
  };

  const handleConfirmAiBatch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const payload = {
      source: resizedImage ? ('AI_IMAGE' as const) : ('AI_TEXT' as const),
      items: draftItems.map((item) => ({
        itemName: item.foodName.trim(),
        portionDesc: item.portionDesc.trim() || undefined,
        mealType: aiMealType,
        calories: parseNumericDraftField(item.calories),
        proteinG: parseNumericDraftField(item.proteinG),
        carbsG: parseNumericDraftField(item.carbsG),
        fatG: parseNumericDraftField(item.fatG),
      })),
    };

    const parsed = CreateBatchNutritionLogsSchema.safeParse(payload);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? 'Please review the parsed food items before saving.',
      );
      return;
    }

    try {
      setLocalSubmitting(true);
      if (onSubmitMealsBatch) {
        await onSubmitMealsBatch(parsed.data);
      } else {
        for (const item of parsed.data.items) {
          await onSubmitMeal({
            itemName: item.itemName,
            mealType: item.mealType,
            calories: item.calories,
            proteinG: item.proteinG,
            carbsG: item.carbsG,
            fatG: item.fatG,
            loggedDate: item.loggedDate,
          });
        }
      }
      resetAiFlow();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save AI-logged meals.');
    } finally {
      setLocalSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (activeTab === 'meal') {
      const parsed = createNutritionLogSchema.safeParse({
        itemName: mealForm.itemName,
        mealType: mealForm.mealType,
        calories: mealForm.calories,
        proteinG: mealForm.proteinG,
        carbsG: mealForm.carbsG,
        fatG: mealForm.fatG,
      });

      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Please check meal input fields.');
        return;
      }

      try {
        setLocalSubmitting(true);
        await onSubmitMeal(parsed.data);
        setMealForm(DEFAULT_MEAL_FORM);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to log meal.');
      } finally {
        setLocalSubmitting(false);
      }
      return;
    }

    const parsed = createWorkoutLogSchema.safeParse({
      activityName: workoutForm.activityName,
      category: workoutForm.category,
      durationMin: workoutForm.durationMin,
      activeCalories: workoutForm.activeCalories,
      intensity: workoutForm.intensity,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check workout input fields.');
      return;
    }

    try {
      setLocalSubmitting(true);
      await onSubmitWorkout(parsed.data);
      setWorkoutForm(DEFAULT_WORKOUT_FORM);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log workout.');
    } finally {
      setLocalSubmitting(false);
    }
  };

  const inputClasses =
    'min-h-[44px] w-full rounded-2xl border border-white/10 bg-[#0A0C10]/80 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-slate-500 focus:border-[#2EE6A6]/60 focus:outline-none focus:ring-1 focus:ring-[#2EE6A6]/40';

  const renderErrorAlert = () => {
    if (!error) return null;
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[#FF5C6C]/35 bg-[#FF5C6C]/12 px-3.5 py-2.5 text-xs font-medium text-[#FF8A95]"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5C6C]" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="leading-relaxed">{error}</p>
            {activeTab === 'ai' && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('meal');
                  setError(null);
                }}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/15 hover:text-[#2EE6A6]"
              >
                <Utensils className="h-3.5 w-3.5 text-[#2EE6A6]" />
                Switch to Manual Tab
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-log-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div className="animate-sheet-up relative max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl rounded-b-none border-t border-x border-white/10 bg-[#141720]/98 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-lg sm:rounded-3xl sm:border sm:p-6 sm:shadow-[0_32px_80px_-16px_rgba(0,0,0,0.95)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
        />

        {/* iOS-style drag handle */}
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/20 sm:hidden"
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="quick-log-modal-title" className="text-lg font-semibold text-white">
              Quick Log
            </h2>
            <p className="text-xs text-slate-400">
              Instant sync with Dynamic TDEE, Macro Rings &amp; Readiness
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close modal"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 3-Way Segmented Tab Switcher */}
        <div className="mt-4 grid grid-cols-3 gap-1.5 rounded-2xl border border-white/5 bg-[#0A0C10]/80 p-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setActiveTab('ai');
              setError(null);
            }}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-1.5 text-[11px] font-semibold whitespace-nowrap transition sm:text-xs ${
              activeTab === 'ai'
                ? 'bg-gradient-to-r from-[#2EE6A6] to-[#38BDF8] text-[#081016] shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>AI Smart Log</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setActiveTab('meal');
              setError(null);
            }}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-1.5 text-[11px] font-semibold whitespace-nowrap transition sm:text-xs ${
              activeTab === 'meal'
                ? 'bg-[#2EE6A6] text-[#081016] shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Utensils className="h-3.5 w-3.5 shrink-0" />
            <span>Manual</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setActiveTab('workout');
              setError(null);
            }}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-1.5 text-[11px] font-semibold whitespace-nowrap transition sm:text-xs ${
              activeTab === 'workout'
                ? 'bg-[#FFB020] text-[#081016] shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Dumbbell className="h-3.5 w-3.5 shrink-0" />
            <span>Workout</span>
          </button>
        </div>

        {/* TAB 1: AI SMART LOG */}
        {activeTab === 'ai' ? (
          <div className="mt-4 space-y-4">
            {analyzing ? (
              <div className="space-y-3" aria-live="polite" aria-busy="true">
                <div className="flex items-center gap-2 rounded-2xl border border-[#38BDF8]/25 bg-[#38BDF8]/10 px-3.5 py-2.5 text-xs font-medium text-[#38BDF8]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#2EE6A6]" />
                  <span>Analyzing meal portions and macros with Gemini AI…</span>
                </div>

                {[0, 1, 2].map((skeletonIdx) => (
                  <div
                    key={skeletonIdx}
                    className="animate-pulse rounded-2xl border border-white/5 bg-[#0F131C]/90 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-4 w-16 rounded-full bg-white/10" />
                      <div className="h-4 w-24 rounded-md bg-white/10" />
                    </div>
                    <div className="mt-3 h-10 w-full rounded-xl bg-white/[0.06]" />
                    <div className="mt-2.5 grid grid-cols-4 gap-2">
                      <div className="h-9 rounded-xl bg-white/[0.06]" />
                      <div className="h-9 rounded-xl bg-[#2EE6A6]/10" />
                      <div className="h-9 rounded-xl bg-[#38BDF8]/10" />
                      <div className="h-9 rounded-xl bg-[#FBBF24]/10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : aiStep === 'input' ? (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="ai-smart-log-textarea"
                    className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-300"
                  >
                    <span>Describe your meal (Thai or English)</span>
                    <span className="text-[11px] text-slate-500">Text, photo, or both</span>
                  </label>
                  <textarea
                    id="ai-smart-log-textarea"
                    rows={3}
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    placeholder="เช่น ข้าวสวย 200 กรัม อกไก่ย่าง 1 ชิ้น ไข่ต้ม 2 ฟอง หรืออัปโหลดรูปอาหาร/ฉลากโภชนาการ..."
                    className="min-h-[96px] w-full resize-y rounded-2xl border border-white/10 bg-[#0A0C10]/80 px-3.5 py-2.5 text-base leading-relaxed text-white placeholder:text-slate-500 focus:border-[#2EE6A6]/60 focus:outline-none focus:ring-1 focus:ring-[#2EE6A6]/40 sm:text-sm"
                  />
                </div>

                {/* 1-tap Thai/English sample prompt chips */}
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    <Sparkles className="h-3 w-3 text-[#2EE6A6]" />
                    <span>Sample Prompts</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AI_SAMPLE_PROMPTS.map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => {
                          setAiText(sample);
                          setError(null);
                        }}
                        className="min-h-[40px] rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-xs font-medium text-slate-200 transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6] sm:min-h-0"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Photo Upload / Mobile Camera */}
                <div>
                  <input
                    id={fileInputId}
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    disabled={resizingImage || analyzing || busy}
                    className="sr-only"
                  />

                  {!resizedImage ? (
                    <label
                      htmlFor={fileInputId}
                      className={`flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-[#0A0C10]/65 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-[#38BDF8]/50 hover:bg-[#38BDF8]/10 hover:text-white sm:text-xs ${
                        resizingImage ? 'pointer-events-none opacity-60' : ''
                      }`}
                    >
                      {resizingImage ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-[#38BDF8]" />
                          <span>Optimizing photo (1024px JPEG)…</span>
                        </>
                      ) : (
                        <>
                          <Camera className="h-4 w-4 text-[#38BDF8]" />
                          <span>Take Photo or Upload Food / Nutrition Label</span>
                        </>
                      )}
                    </label>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0A0C10]/85 p-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <img
                          src={resizedImage.previewUrl}
                          alt="Uploaded meal preview"
                          className="h-14 w-14 shrink-0 rounded-xl border border-white/10 object-cover"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-white">
                            {resizedImage.file.name}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="tabular-nums rounded-full border border-[#38BDF8]/30 bg-[#38BDF8]/10 px-2 py-0.5 text-[10px] font-semibold text-[#38BDF8]">
                              {resizedImage.width}×{resizedImage.height}px ·{' '}
                              {formatFileSizeKb(resizedImage.resizedSize)}
                            </span>
                            {resizedImage.originalSize > resizedImage.resizedSize && (
                              <span className="tabular-nums text-[10px] text-slate-400">
                                from {formatFileSizeKb(resizedImage.originalSize)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => replaceResizedImage(null)}
                        aria-label="Remove uploaded photo"
                        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition hover:border-[#FF5C6C]/40 hover:bg-[#FF5C6C]/15 hover:text-[#FF5C6C]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {renderErrorAlert()}

                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onClose}
                    className="min-h-[44px] rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50 sm:text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAnalyzeWithAI()}
                    disabled={resizingImage || analyzing || (!aiText.trim() && !resizedImage)}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#2EE6A6] to-[#38BDF8] px-5 py-2.5 text-sm font-bold text-[#081016] shadow-[0_0_24px_-6px_rgba(46,230,166,0.5)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:text-xs"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>Analyze with Gemini AI</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Step 2: Preview & Edit before Saving */
              <form onSubmit={handleConfirmAiBatch} className="space-y-3.5">
                {/* Preview Header: Meal Type + Back / Re-analyze */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAiStep('input');
                      setError(null);
                    }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back / Re-analyze
                  </button>

                  <div className="min-w-[140px] flex-1 sm:flex-none">
                    <label htmlFor="ai-preview-meal-type" className="sr-only">
                      Meal Type
                    </label>
                    <select
                      id="ai-preview-meal-type"
                      value={aiMealType}
                      onChange={(e) =>
                        setAiMealType(e.target.value as BatchNutritionLogItemInput['mealType'])
                      }
                      className={inputClasses}
                    >
                      <option value="breakfast">Breakfast</option>
                      <option value="lunch">Lunch</option>
                      <option value="dinner">Dinner</option>
                      <option value="snack">Snack</option>
                    </select>
                  </div>
                </div>

                {/* Total Preview kcal & P/C/F strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#0A0C10]/85 px-3.5 py-2.5">
                  <div className="tabular-nums text-xs font-semibold text-white">
                    Total:{' '}
                    <span className="text-sm font-bold text-white">
                      {Math.round(draftTotals.calories).toLocaleString()}
                    </span>{' '}
                    <span className="text-slate-400">kcal</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="tabular-nums rounded-lg bg-[#2EE6A6]/12 px-2 py-0.5 text-[11px] font-semibold text-[#2EE6A6]">
                      P {Math.round(draftTotals.proteinG)}g
                    </span>
                    <span className="tabular-nums rounded-lg bg-[#38BDF8]/12 px-2 py-0.5 text-[11px] font-semibold text-[#38BDF8]">
                      C {Math.round(draftTotals.carbsG)}g
                    </span>
                    <span className="tabular-nums rounded-lg bg-[#FBBF24]/12 px-2 py-0.5 text-[11px] font-semibold text-[#FBBF24]">
                      F {Math.round(draftTotals.fatG)}g
                    </span>
                  </div>
                </div>

                {/* Editable Parsed Food Cards */}
                {draftItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-[#0F131C]/60 px-4 py-6 text-center text-xs text-slate-400">
                    No food items remain. Add an item below or go back to re-analyze.
                  </div>
                ) : (
                  <div className="max-h-[38dvh] space-y-3 overflow-y-auto pr-0.5">
                    {draftItems.map((item, idx) => {
                      const conf = CONFIDENCE_BADGE[item.confidence];
                      return (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-white/10 bg-[#0F131C]/90 p-3.5 space-y-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${conf.classes}`}
                              >
                                {conf.label}
                              </span>
                              <span className="truncate text-[11px] text-slate-400">
                                {item.portionDesc || `Item #${idx + 1}`}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDeleteDraftItem(item.id)}
                              aria-label={`Delete ${item.foodName || `item ${idx + 1}`}`}
                              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#FF5C6C]/15 hover:text-[#FF5C6C]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-medium text-slate-400">
                              Food Name
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="Food name"
                              value={item.foodName}
                              onChange={(e) =>
                                handleUpdateDraftItem(item.id, 'foodName', e.target.value)
                              }
                              className={inputClasses}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div>
                              <label className="mb-1 block text-[11px] font-medium text-slate-300">
                                Calories
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={10000}
                                step="1"
                                required
                                value={item.calories}
                                onChange={(e) =>
                                  handleUpdateDraftItem(item.id, 'calories', e.target.value)
                                }
                                className={`${inputClasses} tabular-nums`}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] font-medium text-[#2EE6A6]">
                                Protein (g)
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={1000}
                                step="0.5"
                                required
                                value={item.proteinG}
                                onChange={(e) =>
                                  handleUpdateDraftItem(item.id, 'proteinG', e.target.value)
                                }
                                className={`${inputClasses} tabular-nums`}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] font-medium text-[#38BDF8]">
                                Carbs (g)
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={1500}
                                step="0.5"
                                required
                                value={item.carbsG}
                                onChange={(e) =>
                                  handleUpdateDraftItem(item.id, 'carbsG', e.target.value)
                                }
                                className={`${inputClasses} tabular-nums`}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] font-medium text-[#FBBF24]">
                                Fat (g)
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={1000}
                                step="0.5"
                                required
                                value={item.fatG}
                                onChange={(e) =>
                                  handleUpdateDraftItem(item.id, 'fatG', e.target.value)
                                }
                                className={`${inputClasses} tabular-nums`}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleAddBlankItem}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6]"
                >
                  <Plus className="h-4 w-4" />
                  Add blank item
                </button>

                {renderErrorAlert()}

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
                    disabled={busy || draftItems.length === 0}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-5 py-2.5 text-sm font-bold text-[#081016] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55 sm:flex-none sm:text-xs"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    <span>Confirm &amp; Save</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          /* TAB 2 & TAB 3: MANUAL MEAL & WORKOUT */
          <>
            {/* 1-Click Quick-Fill Presets */}
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                <Sparkles className="h-3 w-3 text-[#2EE6A6]" />
                <span>1-Click Presets</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeTab === 'meal'
                  ? MEAL_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => applyMealPreset(preset)}
                        className="min-h-[40px] rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6] sm:min-h-0 sm:px-3 sm:py-1.5"
                      >
                        {preset.label}
                      </button>
                    ))
                  : WORKOUT_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => applyWorkoutPreset(preset)}
                        className="min-h-[40px] rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:border-[#FFB020]/40 hover:bg-[#FFB020]/10 hover:text-[#FFB020] sm:min-h-0 sm:px-3 sm:py-1.5"
                      >
                        {preset.label}
                      </button>
                    ))}
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              {activeTab === 'meal' ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Food / Meal Name
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Grilled Chicken Bowl"
                        value={mealForm.itemName}
                        onChange={(e) => setMealForm({ ...mealForm, itemName: e.target.value })}
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Meal Type
                      </label>
                      <select
                        value={mealForm.mealType}
                        onChange={(e) =>
                          setMealForm({
                            ...mealForm,
                            mealType: e.target.value as CreateNutritionLogInput['mealType'],
                          })
                        }
                        className={inputClasses}
                      >
                        <option value="breakfast">Breakfast</option>
                        <option value="lunch">Lunch</option>
                        <option value="dinner">Dinner</option>
                        <option value="snack">Snack</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Calories
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={10000}
                        step="1"
                        required
                        value={mealForm.calories}
                        onChange={(e) => setMealForm({ ...mealForm, calories: e.target.value })}
                        className={`${inputClasses} tabular-nums`}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#2EE6A6]">
                        Protein (g)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={1000}
                        step="0.5"
                        required
                        value={mealForm.proteinG}
                        onChange={(e) => setMealForm({ ...mealForm, proteinG: e.target.value })}
                        className={`${inputClasses} tabular-nums`}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#38BDF8]">
                        Carbs (g)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={1500}
                        step="0.5"
                        required
                        value={mealForm.carbsG}
                        onChange={(e) => setMealForm({ ...mealForm, carbsG: e.target.value })}
                        className={`${inputClasses} tabular-nums`}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#FBBF24]">
                        Fat (g)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={1000}
                        step="0.5"
                        required
                        value={mealForm.fatG}
                        onChange={(e) => setMealForm({ ...mealForm, fatG: e.target.value })}
                        className={`${inputClasses} tabular-nums`}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Activity Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Push Day Hypertrophy"
                      value={workoutForm.activityName}
                      onChange={(e) =>
                        setWorkoutForm({ ...workoutForm, activityName: e.target.value })
                      }
                      className={inputClasses}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Category
                      </label>
                      <select
                        value={workoutForm.category}
                        onChange={(e) =>
                          setWorkoutForm({
                            ...workoutForm,
                            category: e.target.value as WorkoutCategory,
                          })
                        }
                        className={inputClasses}
                      >
                        <option value="strength">Strength</option>
                        <option value="cardio">Cardio</option>
                        <option value="hiit">HIIT</option>
                        <option value="mobility">Mobility</option>
                        <option value="sport">Sport</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Duration (min)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={1}
                        max={1440}
                        step="1"
                        required
                        value={workoutForm.durationMin}
                        onChange={(e) =>
                          setWorkoutForm({ ...workoutForm, durationMin: e.target.value })
                        }
                        className={`${inputClasses} tabular-nums`}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#FFB020]">
                        Burn (kcal)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={10000}
                        step="1"
                        required
                        value={workoutForm.activeCalories}
                        onChange={(e) =>
                          setWorkoutForm({ ...workoutForm, activeCalories: e.target.value })
                        }
                        className={`${inputClasses} tabular-nums`}
                      />
                    </div>

                    <div className="col-span-2 sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Intensity
                      </label>
                      <select
                        value={workoutForm.intensity}
                        onChange={(e) =>
                          setWorkoutForm({
                            ...workoutForm,
                            intensity: e.target.value as WorkoutIntensity,
                          })
                        }
                        className={inputClasses}
                      >
                        <option value="low">Low</option>
                        <option value="moderate">Moderate</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {renderErrorAlert()}

              <div className="flex items-center justify-end gap-2.5 pt-2">
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
                  className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-bold text-[#081016] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70 sm:flex-none sm:text-xs ${
                    activeTab === 'meal' ? 'bg-[#2EE6A6]' : 'bg-[#FFB020]'
                  }`}
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {activeTab === 'meal' ? 'Save Meal' : 'Save Workout'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

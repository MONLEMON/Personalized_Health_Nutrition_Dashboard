import {
  CreateBatchNutritionLogsSchema,
  CreateSavedMealSchema,
  createNutritionLogSchema,
  createWorkoutLogSchema,
  updateNutritionLogSchema,
  type BatchNutritionLogItemInput,
  type CopyYesterdayMealsResponse,
  type CreateBatchNutritionLogsInput,
  type CreateNutritionLogInput,
  type CreateSavedMealInput,
  type CreateWorkoutLogInput,
  type LogSavedMealInput,
  type LoggableMealType,
  type NutritionConfidence,
  type NutritionLogDTO,
  type ParsedFoodItem,
  type RecentMealSuggestionDTO,
  type SavedMealDTO,
  type UpdateNutritionLogInput,
  type WorkoutCategory,
  type WorkoutIntensity,
} from '@health-dash/shared';
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  Camera,
  Check,
  Clock,
  Copy,
  Dumbbell,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
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

export type QuickLogTab = 'ai' | 'saved' | 'meal' | 'workout';

export interface QuickLogModalProps {
  isOpen: boolean;
  initialTab?: QuickLogTab;
  editingMeal?: NutritionLogDTO | null;
  onClose: () => void;
  onSubmitMeal: (input: CreateNutritionLogInput) => Promise<void>;
  onUpdateMeal?: (id: string, input: UpdateNutritionLogInput) => Promise<void>;
  onSubmitMealsBatch?: (input: CreateBatchNutritionLogsInput) => Promise<void>;
  onSubmitWorkout: (input: CreateWorkoutLogInput) => Promise<void>;
  savedMeals?: SavedMealDTO[];
  recentMeals?: RecentMealSuggestionDTO[];
  isSavedMealsLoading?: boolean;
  onLoadSavedMeals?: () => void | Promise<void>;
  onCreateSavedMeal?: (input: CreateSavedMealInput) => Promise<unknown>;
  onDeleteSavedMeal?: (id: string) => Promise<void>;
  onLogSavedMeal?: (id: string, input?: LogSavedMealInput) => Promise<void>;
  onCopyYesterday?: () => Promise<CopyYesterdayMealsResponse>;
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

interface MacroValuesForm {
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

const AI_SAMPLE_PROMPTS: string[] = [
  'ข้าวสวย 200g อกไก่ย่าง ไข่ต้ม 2 ฟอง',
  'กะเพราหมูสับ ไข่ดาว',
  'Whey Isolate 1 scoop + กล้วย 1 ลูก',
];

const AI_ACCURACY_HINTS: string[] = [
  'ไม่ใส่น้ำมัน',
  'ข้าว 1 ทัพพี (~65g)',
  'กินหมดทั้งซอง/ขวด',
  'หวานน้อย 25%',
  'ชั่งน้ำหนักสุก',
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

const MEAL_TYPE_BADGE: Record<LoggableMealType, { label: string; classes: string }> = {
  breakfast: {
    label: 'Breakfast',
    classes: 'border-[#FFB020]/30 bg-[#FFB020]/10 text-[#FFB020]',
  },
  lunch: {
    label: 'Lunch',
    classes: 'border-[#2EE6A6]/30 bg-[#2EE6A6]/10 text-[#2EE6A6]',
  },
  dinner: {
    label: 'Dinner',
    classes: 'border-[#38BDF8]/30 bg-[#38BDF8]/10 text-[#38BDF8]',
  },
  snack: {
    label: 'Snack',
    classes: 'border-purple-400/30 bg-purple-400/10 text-purple-300',
  },
};

const SAVED_MULTIPLIERS = [0.5, 1, 1.5, 2] as const;

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
  mealType: 'lunch' as LoggableMealType,
  calories: '450',
  proteinG: '35',
  carbsG: '45',
  fatG: '12',
};

const DEFAULT_CUSTOM_FAVORITE_FORM = {
  name: '',
  defaultMealType: 'lunch' as LoggableMealType,
  servingNote: '',
  calories: '400',
  proteinG: '30',
  carbsG: '40',
  fatG: '12',
};

const DEFAULT_WORKOUT_FORM = {
  activityName: '',
  category: 'strength' as WorkoutCategory,
  durationMin: '45',
  activeCalories: '280',
  intensity: 'moderate' as WorkoutIntensity,
};

const MACRO_FIELD_META: Array<{
  key: keyof MacroValuesForm;
  label: string;
  max: number;
  labelClass: string;
}> = [
  { key: 'calories', label: 'Calories', max: 10000, labelClass: 'text-slate-300' },
  { key: 'proteinG', label: 'Protein (g)', max: 1000, labelClass: 'text-[#2EE6A6]' },
  { key: 'carbsG', label: 'Carbs (g)', max: 1500, labelClass: 'text-[#38BDF8]' },
  { key: 'fatG', label: 'Fat (g)', max: 1000, labelClass: 'text-[#FBBF24]' },
];

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

function scaleMacro1Decimal(value: number, multiplier: number): number {
  return Math.round(value * multiplier * 10) / 10;
}

function MacroFieldsGrid({
  values,
  onChange,
  inputClasses,
  compact = false,
}: {
  values: MacroValuesForm;
  onChange: (field: keyof MacroValuesForm, value: string) => void;
  inputClasses: string;
  compact?: boolean;
}) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${compact ? 'gap-2' : 'gap-3'}`}>
      {MACRO_FIELD_META.map((field) => (
        <div key={field.key} className="min-w-0">
          <label className={`mb-1 block text-xs font-medium ${field.labelClass}`}>
            {field.label}
          </label>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={field.max}
            step="any"
            required
            value={values[field.key]}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={`${inputClasses} tabular-nums`}
          />
        </div>
      ))}
    </div>
  );
}

export function QuickLogModal({
  isOpen,
  initialTab = 'ai',
  editingMeal = null,
  onClose,
  onSubmitMeal,
  onUpdateMeal,
  onSubmitMealsBatch,
  onSubmitWorkout,
  savedMeals = [],
  recentMeals = [],
  isSavedMealsLoading = false,
  onLoadSavedMeals,
  onCreateSavedMeal,
  onDeleteSavedMeal,
  onLogSavedMeal,
  onCopyYesterday,
  isSubmitting = false,
}: QuickLogModalProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const analysisSeqRef = useRef(0);
  const onLoadSavedMealsRef = useRef(onLoadSavedMeals);
  onLoadSavedMealsRef.current = onLoadSavedMeals;

  const isEditingMeal = Boolean(editingMeal);

  const [activeTab, setActiveTab] = useState<QuickLogTab>(initialTab);
  const [mealForm, setMealForm] = useState(DEFAULT_MEAL_FORM);
  const [saveToFavorites, setSaveToFavorites] = useState(false);
  const [workoutForm, setWorkoutForm] = useState(DEFAULT_WORKOUT_FORM);

  // AI Smart Log states
  const [aiStep, setAiStep] = useState<'input' | 'preview'>('input');
  const [aiText, setAiText] = useState('');
  const [resizedImage, setResizedImage] = useState<ResizedImageResult | null>(null);
  const [resizingImage, setResizingImage] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiMealType, setAiMealType] = useState<BatchNutritionLogItemInput['mealType']>('lunch');
  const [draftItems, setDraftItems] = useState<DraftNutritionItem[]>([]);

  // Saved & Recent states
  const [multipliers, setMultipliers] = useState<Record<string, number>>({});
  const [loggingSavedId, setLoggingSavedId] = useState<string | null>(null);
  const [deletingSavedId, setDeletingSavedId] = useState<string | null>(null);
  const [loggingRecentKey, setLoggingRecentKey] = useState<string | null>(null);
  const [promotingRecentKey, setPromotingRecentKey] = useState<string | null>(null);
  const [copyingYesterday, setCopyingYesterday] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{
    tone: 'mint' | 'amber';
    message: string;
  } | null>(null);
  const [showAddFavoriteForm, setShowAddFavoriteForm] = useState(false);
  const [customFavoriteForm, setCustomFavoriteForm] = useState(DEFAULT_CUSTOM_FAVORITE_FORM);
  const [creatingFavorite, setCreatingFavorite] = useState(false);

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
      setError(null);
      if (editingMeal) {
        setActiveTab('meal');
        setMealForm({
          itemName: editingMeal.itemName,
          mealType: editingMeal.mealType === 'supplement' ? 'snack' : editingMeal.mealType,
          calories: String(editingMeal.calories),
          proteinG: String(editingMeal.proteinG),
          carbsG: String(editingMeal.carbsG),
          fatG: String(editingMeal.fatG),
        });
        setSaveToFavorites(false);
      } else {
        setActiveTab(initialTab);
        setMealForm(DEFAULT_MEAL_FORM);
        setSaveToFavorites(false);
      }
    } else {
      resetAiFlow();
      setMealForm(DEFAULT_MEAL_FORM);
      setSaveToFavorites(false);
      setCopyFeedback(null);
      setShowAddFavoriteForm(false);
      setCustomFavoriteForm(DEFAULT_CUSTOM_FAVORITE_FORM);
    }
  }, [isOpen, initialTab, editingMeal, resetAiFlow]);

  useEffect(() => {
    if (isOpen && !editingMeal && activeTab === 'saved') {
      void onLoadSavedMealsRef.current?.();
    }
  }, [isOpen, editingMeal, activeTab]);

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

  const savedMealNames = useMemo(() => {
    return new Set(savedMeals.map((item) => item.name.trim().toLowerCase()));
  }, [savedMeals]);

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
    e.target.value = '';
    if (!selectedFile) return;

    setError(null);
    setResizingImage(true);
    try {
      const resized = await resizeImageForUpload(selectedFile, 1280, 0.85);
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

  const handleCopyYesterdayClick = async () => {
    if (!onCopyYesterday || copyingYesterday) return;
    setError(null);
    setCopyFeedback(null);
    setCopyingYesterday(true);
    try {
      const res = await onCopyYesterday();
      if (res.copiedCount === 0) {
        setCopyFeedback({
          tone: 'amber',
          message: `No meals found logged on ${res.sourceDate}.`,
        });
      } else {
        setCopyFeedback({
          tone: 'mint',
          message: `Copied ${res.copiedCount} ${res.copiedCount === 1 ? 'meal' : 'meals'} from ${res.sourceDate} into today!`,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy yesterday's meals.");
    } finally {
      setCopyingYesterday(false);
    }
  };

  const handleLogSavedClick = async (savedMeal: SavedMealDTO) => {
    if (!onLogSavedMeal) return;
    const multiplier = multipliers[savedMeal.id] ?? 1;
    setError(null);
    setLoggingSavedId(savedMeal.id);
    try {
      await onLogSavedMeal(savedMeal.id, { multiplier });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log saved meal.');
    } finally {
      setLoggingSavedId(null);
    }
  };

  const handleDeleteSavedClick = async (id: string) => {
    if (!onDeleteSavedMeal) return;
    setError(null);
    setDeletingSavedId(id);
    try {
      await onDeleteSavedMeal(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete saved meal.');
    } finally {
      setDeletingSavedId(null);
    }
  };

  const handleCreateCustomFavoriteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!onCreateSavedMeal) return;
    setError(null);

    const parsed = CreateSavedMealSchema.safeParse({
      name: customFavoriteForm.name,
      defaultMealType: customFavoriteForm.defaultMealType,
      calories: customFavoriteForm.calories,
      proteinG: customFavoriteForm.proteinG,
      carbsG: customFavoriteForm.carbsG,
      fatG: customFavoriteForm.fatG,
      servingNote: customFavoriteForm.servingNote.trim() || null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check custom favorite fields.');
      return;
    }

    setCreatingFavorite(true);
    try {
      await onCreateSavedMeal(parsed.data);
      setCustomFavoriteForm(DEFAULT_CUSTOM_FAVORITE_FORM);
      setShowAddFavoriteForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create favorite meal.');
    } finally {
      setCreatingFavorite(false);
    }
  };

  const handlePromoteRecentClick = async (recent: RecentMealSuggestionDTO, key: string) => {
    if (!onCreateSavedMeal) return;
    setError(null);
    setPromotingRecentKey(key);
    try {
      await onCreateSavedMeal({
        name: recent.itemName,
        defaultMealType: recent.mealType,
        calories: recent.calories,
        proteinG: recent.proteinG,
        carbsG: recent.carbsG,
        fatG: recent.fatG,
        servingNote: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote meal to favorites.');
    } finally {
      setPromotingRecentKey(null);
    }
  };

  const handleLogRecentClick = async (recent: RecentMealSuggestionDTO, key: string) => {
    setError(null);
    setLoggingRecentKey(key);
    try {
      await onSubmitMeal({
        itemName: recent.itemName,
        mealType: recent.mealType,
        calories: recent.calories,
        proteinG: recent.proteinG,
        carbsG: recent.carbsG,
        fatG: recent.fatG,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log recent meal.');
    } finally {
      setLoggingRecentKey(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isEditingMeal && editingMeal) {
      if (!onUpdateMeal) {
        setError('Meal editing is unavailable right now.');
        return;
      }

      const parsed = updateNutritionLogSchema.safeParse({
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
        await onUpdateMeal(editingMeal.id, parsed.data);
        setMealForm(DEFAULT_MEAL_FORM);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update meal.');
      } finally {
        setLocalSubmitting(false);
      }
      return;
    }

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
        if (saveToFavorites && onCreateSavedMeal) {
          try {
            await onCreateSavedMeal({
              name: parsed.data.itemName,
              defaultMealType: parsed.data.mealType,
              calories: parsed.data.calories,
              proteinG: parsed.data.proteinG,
              carbsG: parsed.data.carbsG,
              fatG: parsed.data.fatG,
              servingNote: null,
            });
          } catch {
            // Meal was already logged cleanly; keep non-blocking
          }
        }
        setMealForm(DEFAULT_MEAL_FORM);
        setSaveToFavorites(false);
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
    'min-h-[44px] w-full min-w-0 max-w-full rounded-2xl border border-white/10 bg-[#0A0C10]/80 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-slate-500 focus:border-[#2EE6A6]/60 focus:outline-none focus:ring-1 focus:ring-[#2EE6A6]/40';

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
            <p className="break-words leading-relaxed">{error}</p>
            {activeTab === 'ai' && !isEditingMeal && (
              <div className="flex flex-wrap items-center gap-2">
                {aiStep === 'input' ? (
                  <button
                    type="button"
                    disabled={analyzing || resizingImage || (!aiText.trim() && !resizedImage)}
                    onClick={() => void handleAnalyzeWithAI()}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#38BDF8]/35 bg-[#38BDF8]/15 px-3 py-1.5 text-xs font-semibold text-[#38BDF8] transition hover:bg-[#38BDF8]/25 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry AI
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('meal');
                    setError(null);
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/15 hover:text-[#2EE6A6]"
                >
                  <Utensils className="h-3.5 w-3.5 text-[#2EE6A6]" />
                  Switch to Manual Tab
                </button>
              </div>
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
      <div className="animate-sheet-up relative max-h-[90dvh] w-full overflow-x-hidden overflow-y-auto rounded-t-3xl rounded-b-none border-t border-x border-white/10 bg-[#141720]/98 px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-lg sm:rounded-3xl sm:border sm:p-6 sm:shadow-[0_32px_80px_-16px_rgba(0,0,0,0.95)]">
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
          <div className="min-w-0 flex-1">
            <h2 id="quick-log-modal-title" className="text-lg font-semibold text-white">
              {isEditingMeal ? 'Edit Meal' : 'Quick Log'}
            </h2>
            <p className="text-xs text-slate-400">
              {isEditingMeal
                ? 'Update meal details, calories, or macros'
                : 'Instant sync with Dynamic TDEE, Macro Rings & Readiness'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close modal"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 4-Way Segmented Tab Switcher (hidden when editing an existing meal) */}
        {!isEditingMeal ? (
          <div className="mt-4 grid grid-cols-4 gap-1 rounded-2xl border border-white/5 bg-[#0A0C10]/80 p-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setActiveTab('ai');
                setError(null);
              }}
              className={`flex min-h-[44px] min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold whitespace-nowrap transition sm:gap-1.5 sm:px-2 sm:text-xs ${
                activeTab === 'ai'
                  ? 'bg-gradient-to-r from-[#2EE6A6] to-[#38BDF8] text-[#081016] shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">AI Log</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setActiveTab('saved');
                setError(null);
              }}
              className={`flex min-h-[44px] min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold whitespace-nowrap transition sm:gap-1.5 sm:px-2 sm:text-xs ${
                activeTab === 'saved'
                  ? 'bg-[#38BDF8] text-[#081016] shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bookmark className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Saved</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setActiveTab('meal');
                setError(null);
              }}
              className={`flex min-h-[44px] min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold whitespace-nowrap transition sm:gap-1.5 sm:px-2 sm:text-xs ${
                activeTab === 'meal'
                  ? 'bg-[#2EE6A6] text-[#081016] shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Utensils className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Manual</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setActiveTab('workout');
                setError(null);
              }}
              className={`flex min-h-[44px] min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold whitespace-nowrap transition sm:gap-1.5 sm:px-2 sm:text-xs ${
                activeTab === 'workout'
                  ? 'bg-[#FFB020] text-[#081016] shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Dumbbell className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Workout</span>
            </button>
          </div>
        ) : null}

        {/* TAB 1: AI SMART LOG */}
        {!isEditingMeal && activeTab === 'ai' ? (
          <div className="mt-4 min-w-0 space-y-4">
            {analyzing ? (
              <div className="space-y-3" aria-live="polite" aria-busy="true">
                <div className="flex items-center gap-2 rounded-2xl border border-[#38BDF8]/25 bg-[#38BDF8]/10 px-3.5 py-2.5 text-xs font-medium text-[#38BDF8]">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#2EE6A6]" />
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
              <div className="min-w-0 space-y-4">
                <div className="min-w-0">
                  <label
                    htmlFor="ai-smart-log-textarea"
                    className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-xs font-medium text-slate-300"
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
                    className="min-h-[96px] w-full min-w-0 max-w-full resize-y rounded-2xl border border-white/10 bg-[#0A0C10]/80 px-3.5 py-2.5 text-base leading-relaxed text-white placeholder:text-slate-500 focus:border-[#2EE6A6]/60 focus:outline-none focus:ring-1 focus:ring-[#2EE6A6]/40 sm:text-sm"
                  />

                  {/* 1-tap Accuracy Hint chips */}
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Accuracy hints:
                    </span>
                    {AI_ACCURACY_HINTS.map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        onClick={() => {
                          setError(null);
                          setAiText((prev) => {
                            const trimmed = prev.trim();
                            if (!trimmed) return hint;
                            if (trimmed.includes(hint)) return prev;
                            return `${trimmed}, ${hint}`;
                          });
                        }}
                        className="min-h-[34px] max-w-full rounded-full border border-[#38BDF8]/25 bg-[#38BDF8]/10 px-2.5 py-1 text-left text-[11px] font-medium text-[#38BDF8] transition hover:border-[#38BDF8]/50 hover:bg-[#38BDF8]/20"
                      >
                        + {hint}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 1-tap Thai/English sample prompt chips */}
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    <Sparkles className="h-3 w-3 shrink-0 text-[#2EE6A6]" />
                    <span>Sample Prompts</span>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    {AI_SAMPLE_PROMPTS.map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => {
                          setAiText(sample);
                          setError(null);
                        }}
                        className="min-h-[40px] max-w-full rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-xs leading-snug font-medium text-slate-200 transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6] sm:min-h-0"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Photo Upload / Mobile Camera */}
                <div className="min-w-0">
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
                      className={`flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-[#0A0C10]/65 px-4 py-3 text-center text-sm font-medium text-slate-200 transition hover:border-[#38BDF8]/50 hover:bg-[#38BDF8]/10 hover:text-white sm:text-xs ${
                        resizingImage ? 'pointer-events-none opacity-60' : ''
                      }`}
                    >
                      {resizingImage ? (
                        <>
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#38BDF8]" />
                          <span>Optimizing photo (1280px JPEG)…</span>
                        </>
                      ) : (
                        <>
                          <Camera className="h-4 w-4 shrink-0 text-[#38BDF8]" />
                          <span className="min-w-0">Take Photo or Upload Food / Nutrition Label</span>
                        </>
                      )}
                    </label>
                  ) : (
                    <div className="flex min-w-0 items-center justify-between gap-2.5 rounded-2xl border border-white/10 bg-[#0A0C10]/85 p-2.5 sm:gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                        <img
                          src={resizedImage.previewUrl}
                          alt="Uploaded meal preview"
                          className="h-14 w-14 shrink-0 rounded-xl border border-white/10 object-cover"
                        />
                        <div className="min-w-0 flex-1">
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
                    className="min-h-[44px] shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50 sm:text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAnalyzeWithAI()}
                    disabled={resizingImage || analyzing || (!aiText.trim() && !resizedImage)}
                    className="inline-flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#2EE6A6] to-[#38BDF8] px-4 py-2.5 text-sm font-bold text-[#081016] shadow-[0_0_24px_-6px_rgba(46,230,166,0.5)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:text-xs"
                  >
                    <Sparkles className="h-4 w-4 shrink-0" />
                    <span className="truncate">Analyze with Gemini AI</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Step 2: Preview & Edit before Saving */
              <form onSubmit={handleConfirmAiBatch} className="min-w-0 space-y-3.5">
                {/* Preview Header: Meal Type + Back / Re-analyze */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAiStep('input');
                      setError(null);
                    }}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back / Re-analyze
                  </button>

                  <div className="min-w-0 flex-1 sm:min-w-[140px] sm:flex-none">
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
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#0A0C10]/85 px-3.5 py-2.5">
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
                          className="min-w-0 space-y-2.5 rounded-2xl border border-white/10 bg-[#0F131C]/90 p-3.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                              <span
                                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${conf.classes}`}
                              >
                                {conf.label}
                              </span>
                              <span className="min-w-0 truncate text-[11px] text-slate-400">
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

                          <div className="min-w-0">
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
                            <div className="min-w-0">
                              <label className="mb-1 block text-[11px] font-medium text-slate-300">
                                Calories
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={10000}
                                step="any"
                                required
                                value={item.calories}
                                onChange={(e) =>
                                  handleUpdateDraftItem(item.id, 'calories', e.target.value)
                                }
                                className={`${inputClasses} tabular-nums`}
                              />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-[11px] font-medium text-[#2EE6A6]">
                                Protein (g)
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={1000}
                                step="any"
                                required
                                value={item.proteinG}
                                onChange={(e) =>
                                  handleUpdateDraftItem(item.id, 'proteinG', e.target.value)
                                }
                                className={`${inputClasses} tabular-nums`}
                              />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-[11px] font-medium text-[#38BDF8]">
                                Carbs (g)
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={1500}
                                step="any"
                                required
                                value={item.carbsG}
                                onChange={(e) =>
                                  handleUpdateDraftItem(item.id, 'carbsG', e.target.value)
                                }
                                className={`${inputClasses} tabular-nums`}
                              />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-[11px] font-medium text-[#FBBF24]">
                                Fat (g)
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={1000}
                                step="any"
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
        ) : !isEditingMeal && activeTab === 'saved' ? (
          /* TAB 2: SAVED FAVORITES, RECENT 14-DAY MEALS & COPY YESTERDAY */
          <div className="mt-4 min-w-0 space-y-4">
            {/* 1-click Copy Yesterday Banner */}
            {onCopyYesterday ? (
              <div className="min-w-0 space-y-2 rounded-2xl border border-[#38BDF8]/25 bg-[#38BDF8]/[0.07] p-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white">Repeat Yesterday&apos;s Meals</p>
                    <p className="text-[11px] text-slate-400">
                      1-click copy all non-supplement meals from yesterday into today
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || copyingYesterday}
                    onClick={() => void handleCopyYesterdayClick()}
                    className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-[#38BDF8] px-3.5 py-2 text-xs font-bold text-[#081016] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                  >
                    {copyingYesterday ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>Copy Yesterday&apos;s Meals</span>
                  </button>
                </div>

                {copyFeedback ? (
                  <div
                    role="status"
                    className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                      copyFeedback.tone === 'mint'
                        ? 'border-[#2EE6A6]/35 bg-[#2EE6A6]/12 text-[#2EE6A6]'
                        : 'border-[#FFB020]/35 bg-[#FFB020]/12 text-[#FFB020]'
                    }`}
                  >
                    {copyFeedback.message}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Saved Favorites Header & Toggle */}
            <div className="min-w-0 space-y-2.5">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
                  <Star className="h-3.5 w-3.5 text-[#FFB020]" />
                  <span>Saved Favorites ({savedMeals.length})</span>
                </div>

                {onCreateSavedMeal ? (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setShowAddFavoriteForm((prev) => !prev);
                    }}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{showAddFavoriteForm ? 'Close Form' : 'Add Custom Favorite'}</span>
                  </button>
                ) : null}
              </div>

              {/* Compact Add Custom Favorite Form */}
              {showAddFavoriteForm && onCreateSavedMeal ? (
                <form
                  onSubmit={handleCreateCustomFavoriteSubmit}
                  className="min-w-0 space-y-3 rounded-2xl border border-[#2EE6A6]/25 bg-[#0F131C]/95 p-3.5"
                >
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div className="min-w-0 sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Favorite Name
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Chicken Breast + Rice 200g"
                        value={customFavoriteForm.name}
                        onChange={(e) =>
                          setCustomFavoriteForm((prev) => ({ ...prev, name: e.target.value }))
                        }
                        className={inputClasses}
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Default Meal
                      </label>
                      <select
                        value={customFavoriteForm.defaultMealType}
                        onChange={(e) =>
                          setCustomFavoriteForm((prev) => ({
                            ...prev,
                            defaultMealType: e.target.value as LoggableMealType,
                          }))
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

                  <div className="min-w-0">
                    <label className="mb-1 block text-xs font-medium text-slate-400">
                      Serving Note (optional)
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      placeholder="e.g. 1 bowl · 350g cooked"
                      value={customFavoriteForm.servingNote}
                      onChange={(e) =>
                        setCustomFavoriteForm((prev) => ({
                          ...prev,
                          servingNote: e.target.value,
                        }))
                      }
                      className={inputClasses}
                    />
                  </div>

                  <MacroFieldsGrid
                    compact
                    values={customFavoriteForm}
                    onChange={(field, value) =>
                      setCustomFavoriteForm((prev) => ({ ...prev, [field]: value }))
                    }
                    inputClasses={inputClasses}
                  />

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddFavoriteForm(false)}
                      className="min-h-[40px] rounded-xl border border-white/10 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creatingFavorite}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#2EE6A6] px-4 py-1.5 text-xs font-bold text-[#081016] transition hover:brightness-110 disabled:opacity-60"
                    >
                      {creatingFavorite ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      <span>Save Favorite</span>
                    </button>
                  </div>
                </form>
              ) : null}

              {/* Favorites List */}
              {isSavedMealsLoading && savedMeals.length === 0 ? (
                <div className="space-y-2">
                  {[0, 1].map((idx) => (
                    <div
                      key={idx}
                      className="h-24 animate-pulse rounded-2xl border border-white/5 bg-[#0F131C]/80"
                    />
                  ))}
                </div>
              ) : savedMeals.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#0F131C]/50 px-4 py-5 text-center text-xs text-slate-400">
                  No saved favorites yet. Tap the bookmark icon on any logged meal or create one above!
                </div>
              ) : (
                <ul className="max-h-[26dvh] space-y-2.5 overflow-y-auto pr-0.5">
                  {savedMeals.map((meal) => {
                    const mult = multipliers[meal.id] ?? 1;
                    const badge = MEAL_TYPE_BADGE[meal.defaultMealType] ?? MEAL_TYPE_BADGE.snack;
                    const isLogging = loggingSavedId === meal.id;
                    const isDeleting = deletingSavedId === meal.id;

                    return (
                      <li
                        key={meal.id}
                        className="min-w-0 space-y-2.5 rounded-2xl border border-white/10 bg-[#0F131C]/90 p-3"
                      >
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.classes}`}
                              >
                                {badge.label}
                              </span>
                              {meal.usageCount > 0 ? (
                                <span className="tabular-nums text-[10px] text-slate-400">
                                  Used {meal.usageCount}×
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-words text-sm font-semibold text-white">
                              {meal.name}
                            </p>
                            {meal.servingNote ? (
                              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                {meal.servingNote}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {onLogSavedMeal ? (
                              <button
                                type="button"
                                disabled={busy || isLogging || isDeleting}
                                onClick={() => void handleLogSavedClick(meal)}
                                className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-[#2EE6A6] px-3 py-1.5 text-xs font-bold text-[#081016] transition hover:brightness-110 disabled:opacity-60"
                              >
                                {isLogging ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )}
                                <span>Log</span>
                              </button>
                            ) : null}
                            {onDeleteSavedMeal ? (
                              <button
                                type="button"
                                disabled={busy || isLogging || isDeleting}
                                onClick={() => void handleDeleteSavedClick(meal.id)}
                                aria-label={`Delete favorite ${meal.name}`}
                                className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#FF5C6C]/15 hover:text-[#FF5C6C] disabled:opacity-50"
                              >
                                {isDeleting ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {/* Multiplier + scaled macros */}
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="tabular-nums text-xs font-bold text-white">
                              {Math.round(meal.calories * mult)} kcal
                            </span>
                            <span className="tabular-nums rounded-md bg-[#2EE6A6]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#2EE6A6]">
                              P {scaleMacro1Decimal(meal.proteinG, mult)}g
                            </span>
                            <span className="tabular-nums rounded-md bg-[#38BDF8]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#38BDF8]">
                              C {scaleMacro1Decimal(meal.carbsG, mult)}g
                            </span>
                            <span className="tabular-nums rounded-md bg-[#FBBF24]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#FBBF24]">
                              F {scaleMacro1Decimal(meal.fatG, mult)}g
                            </span>
                          </div>

                          <div
                            role="group"
                            aria-label={`Portion multiplier for ${meal.name}`}
                            className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#0A0C10]/80 p-0.5"
                          >
                            {SAVED_MULTIPLIERS.map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() =>
                                  setMultipliers((prev) => ({ ...prev, [meal.id]: m }))
                                }
                                className={`min-h-[30px] rounded-lg px-2 text-[11px] font-semibold tabular-nums transition ${
                                  mult === m
                                    ? 'bg-[#2EE6A6]/20 text-[#2EE6A6]'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                              >
                                {m}x
                              </button>
                            ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Recent 14-Day Meals */}
            <div className="min-w-0 space-y-2.5 border-t border-white/5 pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Clock className="h-3.5 w-3.5 text-[#38BDF8]" />
                <span>Recent Meals (14 Days)</span>
              </div>

              {isSavedMealsLoading && recentMeals.length === 0 ? (
                <div className="h-20 animate-pulse rounded-2xl border border-white/5 bg-[#0F131C]/80" />
              ) : recentMeals.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#0F131C]/50 px-4 py-4 text-center text-xs text-slate-400">
                  No recent meals logged in the past 14 days yet.
                </div>
              ) : (
                <ul className="max-h-[24dvh] space-y-2 overflow-y-auto pr-0.5">
                  {recentMeals.map((recent) => {
                    const key = `${recent.itemName.toLowerCase()}::${recent.mealType}`;
                    const badge = MEAL_TYPE_BADGE[recent.mealType] ?? MEAL_TYPE_BADGE.snack;
                    const alreadySaved = savedMealNames.has(recent.itemName.trim().toLowerCase());
                    const isPromoting = promotingRecentKey === key;
                    const isLogging = loggingRecentKey === key;

                    return (
                      <li
                        key={key}
                        className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.classes}`}
                            >
                              {badge.label}
                            </span>
                            <span className="tabular-nums text-[10px] text-slate-400">
                              {recent.logCount}× · {recent.lastLoggedDate}
                            </span>
                          </div>
                          <p className="mt-1 break-words text-sm font-medium text-white">
                            {recent.itemName}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums">
                            <span className="font-semibold text-white">
                              {Math.round(recent.calories)} kcal
                            </span>
                            <span className="text-[#2EE6A6]">P {Math.round(recent.proteinG)}g</span>
                            <span className="text-[#38BDF8]">C {Math.round(recent.carbsG)}g</span>
                            <span className="text-[#FBBF24]">F {Math.round(recent.fatG)}g</span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {onCreateSavedMeal ? (
                            <button
                              type="button"
                              disabled={alreadySaved || isPromoting || busy}
                              onClick={() => void handlePromoteRecentClick(recent, key)}
                              title={alreadySaved ? 'Already in Favorites' : 'Save to Favorites'}
                              className={`inline-flex min-h-[38px] items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                                alreadySaved
                                  ? 'border-[#2EE6A6]/30 bg-[#2EE6A6]/10 text-[#2EE6A6]'
                                  : 'border-white/10 bg-white/[0.04] text-slate-200 hover:border-[#FFB020]/40 hover:bg-[#FFB020]/15 hover:text-[#FFB020]'
                              } disabled:opacity-65`}
                            >
                              {isPromoting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Star
                                  className={`h-3.5 w-3.5 ${alreadySaved ? 'fill-current' : 'text-[#FFB020]'}`}
                                />
                              )}
                              <span>{alreadySaved ? 'Saved' : 'Save'}</span>
                            </button>
                          ) : null}

                          <button
                            type="button"
                            disabled={busy || isLogging}
                            onClick={() => void handleLogRecentClick(recent, key)}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#2EE6A6] hover:text-[#081016] disabled:opacity-60"
                          >
                            {isLogging ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                            <span>Log</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {renderErrorAlert()}
          </div>
        ) : (
          /* TAB 3 & TAB 4: MANUAL MEAL (OR EDIT MEAL) & WORKOUT */
          <>
            {/* 1-Click Quick-Fill Presets (create mode only) */}
            {!isEditingMeal ? (
              <div className="mt-4 min-w-0">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  <Sparkles className="h-3 w-3 shrink-0 text-[#2EE6A6]" />
                  <span>1-Click Presets</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeTab === 'meal'
                    ? MEAL_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => applyMealPreset(preset)}
                          className="min-h-[40px] max-w-full rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6] sm:min-h-0 sm:px-3 sm:py-1.5"
                        >
                          {preset.label}
                        </button>
                      ))
                    : WORKOUT_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => applyWorkoutPreset(preset)}
                          className="min-h-[40px] max-w-full rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:border-[#FFB020]/40 hover:bg-[#FFB020]/10 hover:text-[#FFB020] sm:min-h-0 sm:px-3 sm:py-1.5"
                        >
                          {preset.label}
                        </button>
                      ))}
                </div>
              </div>
            ) : null}

            {/* Form */}
            <form onSubmit={handleSubmit} className="mt-4 min-w-0 space-y-3.5">
              {isEditingMeal || activeTab === 'meal' ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="min-w-0 sm:col-span-2">
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
                    <div className="min-w-0">
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Meal Type
                      </label>
                      <select
                        value={mealForm.mealType}
                        onChange={(e) =>
                          setMealForm({
                            ...mealForm,
                            mealType: e.target.value as LoggableMealType,
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

                  <MacroFieldsGrid
                    values={mealForm}
                    onChange={(field, value) => setMealForm((prev) => ({ ...prev, [field]: value }))}
                    inputClasses={inputClasses}
                  />

                  {!isEditingMeal && onCreateSavedMeal ? (
                    <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-2xl border border-white/10 bg-[#0A0C10]/60 px-3.5 py-2 text-xs font-medium text-slate-300 transition hover:border-white/20">
                      <input
                        type="checkbox"
                        checked={saveToFavorites}
                        onChange={(e) => setSaveToFavorites(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-[#141720] accent-[#2EE6A6]"
                      />
                      <span>Save to Favorites too for 1-tap repeat logging</span>
                    </label>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="min-w-0">
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
                    <div className="col-span-2 min-w-0 sm:col-span-1">
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

                    <div className="min-w-0">
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

                    <div className="min-w-0">
                      <label className="mb-1 block text-xs font-medium text-[#FFB020]">
                        Burn (kcal)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={10000}
                        step="any"
                        required
                        value={workoutForm.activeCalories}
                        onChange={(e) =>
                          setWorkoutForm({ ...workoutForm, activeCalories: e.target.value })
                        }
                        className={`${inputClasses} tabular-nums`}
                      />
                    </div>

                    <div className="col-span-2 min-w-0 sm:col-span-1">
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
                    isEditingMeal || activeTab === 'meal' ? 'bg-[#2EE6A6]' : 'bg-[#FFB020]'
                  }`}
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isEditingMeal
                    ? 'Save Changes'
                    : activeTab === 'meal'
                      ? 'Save Meal'
                      : 'Save Workout'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

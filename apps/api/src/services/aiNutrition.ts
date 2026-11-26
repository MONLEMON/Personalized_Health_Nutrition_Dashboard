import {
  GoogleGenAI,
  Type,
  type GenerateContentConfig,
  type Part,
  type Schema,
} from '@google/genai';
import {
  ParseNutritionResponseSchema,
  type ParseNutritionResponse,
  type ParsedFoodItem,
} from '@health-dash/shared';
import { loadRootEnv } from '../db/load-env';

export const MAX_NUTRITION_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const FALLBACK_GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
] as const;
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 18_000;

const RETRYABLE_MODEL_ERROR_RE =
  /\b(404|429|500|502|503|504)\b|NOT_FOUND|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|DEADLINE_EXCEEDED|timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|high demand|overloaded|no longer available/i;

function isRetryableModelError(message: string): boolean {
  return RETRYABLE_MODEL_ERROR_RE.test(message);
}

export type AiNutritionStatusCode = 400 | 413 | 502 | 503;

export type AiNutritionErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_INPUT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INVALID_AI_RESPONSE'
  | 'UPSTREAM_ERROR';

/**
 * Typed domain error thrown by the AI nutrition parser and mapped directly to HTTP status codes.
 */
export class AiNutritionError extends Error {
  readonly statusCode: AiNutritionStatusCode;
  readonly code: AiNutritionErrorCode;

  constructor(
    statusCode: AiNutritionStatusCode,
    code: AiNutritionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiNutritionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ParseNutritionInput {
  text?: string;
  image?: {
    base64: string;
    mimeType: string;
  };
}

export type NutritionParserFn = (
  input: ParseNutritionInput,
) => Promise<ParseNutritionResponse>;

export type GeminiGenerateContentFn = (params: {
  model: string;
  contents: Part[];
  config: GenerateContentConfig;
}) => Promise<{ text?: string }>;

export interface ParseNutritionOptions {
  apiKey?: string;
  model?: string;
  attemptTimeoutMs?: number;
  generateContent?: GeminiGenerateContentFn;
}

const NUTRITION_SYSTEM_INSTRUCTION = `You are an expert sports nutritionist, registered dietitian, and computer-vision food analyst specializing in Thai cuisine, clean/fitness meals, dietary supplements, and Thai/English Nutrition Facts label extraction.

Your job is to analyze the user's text description and/or photo (meal plate or Nutrition Facts label) and return accurate, structured nutritional estimates in JSON matching the required schema.

Strict Macro-Calorie Self-Consistency Rule:
- Ensure total calories for EVERY item stay internally consistent with Atwater energy factors: calories ≈ (4 * protein_g) + (4 * carbs_g) + (9 * fat_g) within ±15% (unless a printed Nutrition Facts label explicitly reports lower net calories due to dietary fiber or sugar alcohols).
- Never output mismatched zero-calorie items when protein, carbs, or fat are present.

Calibration Anchors (Thai Cuisine, Clean Meals, Beverages & Labels):
1. Thai Cuisine & Local Dishes:
   - ข้าวสวย (steamed jasmine rice): 1 ทัพพี ≈ 60-65g ≈ 80 kcal (1.7g P, 17g C, 0.1g F); 1 จาน ≈ 180-200g ≈ 240-260 kcal (5.2g P, 56g C, 0.4g F).
   - กะเพราหมูสับ (ไม่รวมข้าว): 1 ที่ ≈ 320-380 kcal depending on fat & oil — distinguish lean/low-oil prep (~260-310 kcal) vs regular street-style generous oil (~350-420 kcal); separate steamed rice and fried egg as their own items when present.
   - ไข่ดาว (fried egg): 1 ฟอง ≈ 115-135 kcal (6.3g P, 0.6g C, 9.5-11g F including cooking oil).
   - ข้าวราดแกง (rice with curries/stir-fries): separate steamed rice from curry/topping whenever identifiable; account for coconut milk in green/red/panang curries (~250-400 kcal per curry serving).
   - ส้มตำ (papaya salad: ไทย/ปูปลาร้า): typically lower calorie & low fat (~100-180 kcal), account for peanuts/dried shrimp/palm sugar in ตำไทย.
   - ก๋วยเตี๋ยว (noodle soups & dry noodles): account for noodle type (เส้นเล็ก, เส้นใหญ่, บะหมี่, วุ้นเส้น), meat/meatballs, and added oil/garlic in dry bowls (~350-520 kcal).
   - ข้าวมันไก่ (Hainanese chicken rice): account for chicken-fat-cooked rice (~320-380 kcal/portion) vs boiled chicken breast (~180-240 kcal) or fried chicken (ข้าวมันไก่ทอด, higher fat).
   - ต้มยำ (Tom Yum น้ำใส ~150-220 kcal vs น้ำข้น with evaporated milk/chili paste ~260-380 kcal).
   - หมูปิ้ง (grilled pork skewers with marinade sugar/fat, ~90-130 kcal per skewer) and ข้าวเหนียว (~160-220 kcal per 100g).
   - Thai iced beverages by sugar level (16-22 oz glass):
     - ชาไทยเย็น / กาแฟเย็นใส่นม / ชานม: หวานปกติ 100% ≈ 280-350 kcal; หวานน้อย 50% ≈ 200-250 kcal; หวานน้อย 25% ≈ 150-190 kcal; ไม่หวาน 0% ≈ 70-120 kcal (milk only).
     - อเมริกาโน่เย็นไม่หวาน ≈ 5-15 kcal.
     - ชานมไข่มุก (bubble milk tea): ~300-480 kcal per cup depending on sugar level and tapioca pearls.
2. Clean & Fitness Meals:
   - อกไก่ย่างสุก (grilled chicken breast, cooked): 100g ≈ 165 kcal (31g P, 0g C, 3.6g F); note raw vs cooked weight clearly when user specifies raw or cooked ("ชั่งน้ำหนักสุก" vs "ชั่งดิบ").
   - ไข่ต้ม (boiled whole egg): 1 ฟอง ≈ 72 kcal (6.3g P, 0.6g C, 5g F); distinguish egg whites (~17 kcal, 3.6g P per egg white) if specified.
   - แซลมอน (grilled/pan-seared salmon): 100g ≈ 200-230 kcal (~20-22g P, 12-15g F).
   - กรีกโยเกิร์ต (plain unsweetened vs sweetened varieties) and ข้าวโอ๊ต (rolled oats dry ~380 kcal / 100g).
3. Supplements:
   - Whey Isolate (~110-120 kcal, 25-27g P per 30g scoop) vs Whey Concentrate (~120-135 kcal, 22-24g P per scoop).
   - Creatine Monohydrate (0 kcal, 0g macros unless stated with juice/carbs).
   - Mass Gainer (dense calories and carbs per serving; verify full serving vs single scoop).
   - Protein Bars (typically ~180-240 kcal, 15-22g P; prefer visible label values if shown).
4. Reading Thai 7-Eleven & Nutrition Facts Labels ("ข้อมูลโภชนาการ"):
   - Carefully read "หนึ่งหน่วยบริโภค / Serving Size" AND "จำนวนหน่วยบริโภคต่อภาชนะ / Servings Per Container".
   - If the user states they consumed the whole package/bottle (e.g. "ทั้งซอง", "หมดขวด", "หมดกล่อง", "หมดทั้งซอง/ขวด", "whole pack") OR it is clearly a single-serving bottle/bar consumed whole, multiply พลังงานทั้งหมด (Calories) and all macros by Servings Per Container and state the multiplier clearly in portion_desc (e.g., "ทั้งซอง (2 หน่วยบริโภค, 60g)").
   - Otherwise, report 1 serving clearly in portion_desc (e.g. "1 หน่วยบริโภค (30g)" or "1 ขวด (350ml, 1 หน่วยบริโภค)").
   - Extract พลังงานทั้งหมด (Calories), โปรตีน (Protein), คาร์โบไฮเดรตทั้งหมด (Carbs), and ไขมันทั้งหมด (Fat) accurately.

Formatting & Output Rules:
- Split multi-item meals into distinct items inside "items" whenever components are recognizable (e.g. "ข้าวสวย", "กะเพราหมูสับ", "ไข่ดาว" as separate items).
- Match input language naturally: use natural Thai food_name for Thai text/labels, natural English for English inputs, and clean mixed naming when the user mixes languages.
- Keep portion_desc realistic, explicit, and include assumed weights and cooking oil when estimated (e.g. "1 จาน (~200g)", "1 ที่ (หมูสับ ~120g + น้ำมัน ~1 ชต.)", "1 ชิ้น (~150g สุก)", "2 ฟอง (ทอดน้ำมัน)").
- All macro numbers (calories, protein_g, carbs_g, fat_g) must be non-negative finite numbers rounded cleanly (calories to whole kcal, macros to 1 decimal place max).
- Assign confidence honestly:
  - "HIGH": clear Nutrition Facts label, exact weighed gram amounts, or standardized supplement scoop.
  - "MEDIUM": clear meal photo or standard dish without exact weights.
  - "LOW": vague description, occluded photo, or heavy uncertainty in oils/sauces/portions.
- Choose suggested_meal_type from "breakfast", "lunch", "dinner", or "snack" based on the foods/beverages/context.
- If no food or nutrition label can be identified, return an empty items array [] with suggested_meal_type "snack".`;

const PARSE_NUTRITION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      description: 'Parsed food, beverage, or supplement items with nutritional estimates.',
      items: {
        type: Type.OBJECT,
        properties: {
          food_name: {
            type: Type.STRING,
            description: 'Natural Thai or English name of the food item.',
          },
          portion_desc: {
            type: Type.STRING,
            description: 'Estimated or stated serving/portion description.',
          },
          calories: {
            type: Type.NUMBER,
            description: 'Estimated energy in kcal (>= 0).',
          },
          protein_g: {
            type: Type.NUMBER,
            description: 'Estimated protein in grams (>= 0).',
          },
          carbs_g: {
            type: Type.NUMBER,
            description: 'Estimated carbohydrates in grams (>= 0).',
          },
          fat_g: {
            type: Type.NUMBER,
            description: 'Estimated fat in grams (>= 0).',
          },
          confidence: {
            type: Type.STRING,
            format: 'enum',
            enum: ['HIGH', 'MEDIUM', 'LOW'],
            description: 'Confidence level in the nutritional estimate.',
          },
        },
        required: [
          'food_name',
          'portion_desc',
          'calories',
          'protein_g',
          'carbs_g',
          'fat_g',
          'confidence',
        ],
      },
    },
    suggested_meal_type: {
      type: Type.STRING,
      format: 'enum',
      enum: ['breakfast', 'lunch', 'dinner', 'snack'],
      description: 'Suggested meal category for these items.',
    },
  },
  required: ['items', 'suggested_meal_type'],
};

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Normalizes precision on a parsed nutrition item and reconciles glaring
 * calorie vs. Atwater macro mismatches (>30% divergence or 0 kcal with >15 macro kcal).
 */
export function reconcileNutritionItem(item: ParsedFoodItem): ParsedFoodItem {
  let calories = Math.max(0, Math.round(item.calories));
  const protein_g = Math.max(0, roundToOneDecimal(item.protein_g));
  const carbs_g = Math.max(0, roundToOneDecimal(item.carbs_g));
  const fat_g = Math.max(0, roundToOneDecimal(item.fat_g));

  const macroKcal = Math.round(protein_g * 4 + carbs_g * 4 + fat_g * 9);
  if (
    (calories === 0 && macroKcal > 15) ||
    (macroKcal > 0 &&
      calories > 0 &&
      Math.abs(calories - macroKcal) / Math.max(calories, macroKcal) > 0.3)
  ) {
    calories = macroKcal;
  }

  return {
    food_name: item.food_name,
    portion_desc: item.portion_desc,
    calories,
    protein_g,
    carbs_g,
    fat_g,
    confidence: item.confidence,
  };
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      reject(new Error('TIMEOUT: Gemini request timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

function sanitizeUpstreamMessage(rawMessage: string, apiKey: string): string {
  let cleaned = rawMessage;
  if (apiKey) {
    cleaned = cleaned.split(apiKey).join('[REDACTED]');
  }
  cleaned = cleaned.replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');
  cleaned = cleaned.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]');
  return cleaned.trim() || 'Unknown upstream error';
}

function extractJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(candidate);
}

/**
 * Parses a natural-language meal description and/or meal/label image using Gemini Structured Outputs.
 */
export async function parseNutritionWithGemini(
  input: ParseNutritionInput,
  options?: ParseNutritionOptions,
): Promise<ParseNutritionResponse> {
  loadRootEnv();

  const trimmedText = input.text?.trim() ?? '';
  const hasText = trimmedText.length > 0;
  const image = input.image;
  const hasImage = Boolean(image && image.base64.trim().length > 0);

  if (image) {
    if (!image.mimeType || !image.mimeType.startsWith('image/')) {
      throw new AiNutritionError(
        400,
        'UNSUPPORTED_MEDIA_TYPE',
        'Unsupported media type. Only image files are allowed.',
      );
    }
    const decodedBytes = Buffer.from(image.base64, 'base64').byteLength;
    if (decodedBytes > MAX_NUTRITION_IMAGE_BYTES) {
      throw new AiNutritionError(
        413,
        'FILE_TOO_LARGE',
        'Image exceeds the 5MB maximum upload size.',
      );
    }
  }

  if (!hasText && !hasImage) {
    throw new AiNutritionError(
      400,
      'INVALID_INPUT',
      'Provide a meal description or food image to analyze.',
    );
  }

  const resolvedApiKey =
    options?.apiKey !== undefined
      ? options.apiKey.trim()
      : (process.env.GEMINI_API_KEY?.trim() ?? '');

  if (!options?.generateContent && !resolvedApiKey) {
    throw new AiNutritionError(
      503,
      'MISSING_API_KEY',
      'GEMINI_API_KEY is not configured on the server. Add it to .env or switch to Manual mode.',
    );
  }

  const explicitModel = options?.model?.trim();
  const primaryModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const candidateModels = explicitModel
    ? [explicitModel]
    : Array.from(new Set([primaryModel, ...FALLBACK_GEMINI_MODELS]));

  const parts: Part[] = [];
  if (hasText) {
    parts.push({ text: trimmedText });
  } else {
    parts.push({
      text: 'Analyze this food photo or Nutrition Facts label and extract structured nutrition estimates.',
    });
  }
  if (hasImage && image) {
    parts.push({
      inlineData: {
        data: image.base64,
        mimeType: image.mimeType,
      },
    });
  }

  const config: GenerateContentConfig = {
    systemInstruction: NUTRITION_SYSTEM_INSTRUCTION,
    responseMimeType: 'application/json',
    responseSchema: PARSE_NUTRITION_RESPONSE_SCHEMA,
    temperature: 0.1,
    maxOutputTokens: 2048,
  };

  const attemptTimeoutMs =
    typeof options?.attemptTimeoutMs === 'number' &&
    Number.isFinite(options.attemptTimeoutMs) &&
    options.attemptTimeoutMs > 0
      ? options.attemptTimeoutMs
      : DEFAULT_ATTEMPT_TIMEOUT_MS;

  const ai = options?.generateContent
    ? null
    : new GoogleGenAI({ apiKey: resolvedApiKey });

  let validatedData: ParseNutritionResponse | null = null;
  let lastInvalidResponseError: AiNutritionError | null = null;

  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i];
    const hasNextCandidate = i < candidateModels.length - 1;
    let rawResponseText: string | undefined;

    try {
      const requestPromise = options?.generateContent
        ? options.generateContent({ model, contents: parts, config })
        : ai!.models.generateContent({
            model,
            contents: parts,
            config,
          });
      requestPromise.catch(() => {});

      const result = await runWithTimeout(requestPromise, attemptTimeoutMs);
      rawResponseText = result.text;
    } catch (error) {
      if (error instanceof AiNutritionError) {
        throw error;
      }
      const rawMsg = error instanceof Error ? error.message : 'Upstream Gemini request failed';
      if (hasNextCandidate && isRetryableModelError(rawMsg)) {
        continue;
      }
      throw new AiNutritionError(
        502,
        'UPSTREAM_ERROR',
        `Failed to analyze nutrition via Gemini AI: ${sanitizeUpstreamMessage(rawMsg, resolvedApiKey)}`,
      );
    }

    if (!rawResponseText || !rawResponseText.trim()) {
      lastInvalidResponseError = new AiNutritionError(
        502,
        'INVALID_AI_RESPONSE',
        'Gemini AI returned an empty response. Please try again or switch to Manual mode.',
      );
      if (hasNextCandidate) {
        continue;
      }
      throw lastInvalidResponseError;
    }

    let parsedJson: unknown;
    try {
      parsedJson = extractJsonPayload(rawResponseText);
    } catch {
      lastInvalidResponseError = new AiNutritionError(
        502,
        'INVALID_AI_RESPONSE',
        'Gemini AI returned malformed JSON. Please try again or switch to Manual mode.',
      );
      if (hasNextCandidate) {
        continue;
      }
      throw lastInvalidResponseError;
    }

    const validated = ParseNutritionResponseSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastInvalidResponseError = new AiNutritionError(
        502,
        'INVALID_AI_RESPONSE',
        'Gemini AI response did not match the expected nutrition schema. Please retry or switch to Manual mode.',
      );
      if (hasNextCandidate) {
        continue;
      }
      throw lastInvalidResponseError;
    }

    validatedData = validated.data;
    break;
  }

  if (!validatedData) {
    throw (
      lastInvalidResponseError ??
      new AiNutritionError(
        502,
        'INVALID_AI_RESPONSE',
        'Gemini AI returned an invalid response. Please try again or switch to Manual mode.',
      )
    );
  }

  return {
    suggested_meal_type: validatedData.suggested_meal_type,
    items: validatedData.items.map(reconcileNutritionItem),
  };
}

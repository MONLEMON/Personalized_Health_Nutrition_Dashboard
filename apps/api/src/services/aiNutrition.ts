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
} from '@health-dash/shared';
import { loadRootEnv } from '../db/load-env';

export const MAX_NUTRITION_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const FALLBACK_GEMINI_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
] as const;

const RETRYABLE_MODEL_ERROR_RE =
  /\b(404|429|503)\b|NOT_FOUND|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|no longer available/i;

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
  generateContent?: GeminiGenerateContentFn;
}

const NUTRITION_SYSTEM_INSTRUCTION = `You are an expert sports nutritionist, registered dietitian, and computer-vision food analyst specializing in Thai cuisine, clean/fitness meals, dietary supplements, and Nutrition Facts label extraction.

Your job is to analyze the user's text description and/or photo (meal plate or Thai/English Nutrition Facts label) and return accurate, structured nutritional estimates in JSON matching the required schema.

Domain Expertise & Estimation Rules:
1. Thai Cuisine & Local Dishes:
   - Accurately estimate standard Thai portions, cooking oils, coconut milk, and sauces:
     - ข้าวราดแกง (rice with curries/stir-fries): separate steamed rice from curry/topping when identifiable; account for coconut milk in green/red/panang curries.
     - ผัดกะเพรา (holy basil stir-fry): distinguish chicken/lean pork vs regular minced pork and cooking oil; separate ไข่ดาว (fried egg, ~110-140 kcal) when included.
     - ส้มตำ (papaya salad: ไทย/ปูปลาร้า): typically lower calorie & low fat, account for peanuts/dried shrimp/palm sugar in ตำไทย.
     - ก๋วยเตี๋ยว (noodle soups & dry noodles): account for noodle type (เส้นเล็ก, เส้นใหญ่, บะหมี่, วุ้นเส้น), meat/meatballs, and added oil/garlic in dry bowls.
     - ข้าวมันไก่ (Hainanese chicken rice): account for chicken-fat-cooked rice (~320-380 kcal/portion) vs boiled/grilled chicken breast.
     - ต้มยำ (Tom Yum น้ำใส vs น้ำข้น with evaporated milk/chili paste).
     - หมูปิ้ง (grilled pork skewers with marinade sugar/fat, ~90-130 kcal per skewer) and ข้าวเหนียว (sticky rice).
     - ชานมไข่มุก (bubble milk tea): account for milk, syrup/sugar level, and tapioca pearls (~300-480 kcal per cup unless sugar-free specified).
2. Clean & Fitness Meals:
   - ข้าวสวย + อกไก่ย่าง / อกไก่ปั่น (steamed jasmine rice ~130 kcal / 28g carbs per 100g cooked; grilled chicken breast ~165 kcal / 31g protein per 100g cooked).
   - ไข่ต้ม (whole boiled egg ~72 kcal, 6.3g P, 5g F; distinguish egg whites if specified).
   - แซลมอน (grilled/pan-seared salmon ~200-230 kcal per 100g, high protein and omega-3 fat).
   - กรีกโยเกิร์ต (plain Greek yogurt vs sweetened/high-fat varieties) and ข้าวโอ๊ต (rolled oats dry ~380 kcal / 100g).
3. Supplements:
   - Whey Isolate (~110-120 kcal, 25-27g P per 30g scoop) vs Whey Concentrate (~120-135 kcal, 22-24g P per scoop).
   - Creatine Monohydrate (0 kcal, 0g macros unless stated with juice/carbs).
   - Mass Gainer (dense calories and carbs per serving; verify full serving vs single scoop).
   - Protein Bars (typically ~180-240 kcal, 15-22g P; prefer visible label values if shown).
4. Reading Nutrition Facts Labels from Photos (Thai "ข้อมูลโภชนาการ" & English Labels):
   - Carefully check "หนึ่งหน่วยบริโภค / Serving Size" and "จำนวนหน่วยบริโภคต่อภาชนะ / Servings Per Container".
   - If the user says they consumed the whole package/bottle (e.g. "หมดขวด", "ทั้งซอง", "whole pack") or it is a single-serving bottle/bar, compute totals for the consumed amount and state the multiplier in portion_desc.
   - Otherwise, report 1 serving clearly in portion_desc (e.g. "1 serving (30g)" or "1 ขวด (350ml, 1 หน่วยบริโภค)").
   - Read พลังงานทั้งหมด (Calories), โปรตีน (Protein), คาร์โบไฮเดรตทั้งหมด (Carbs), and ไขมันทั้งหมด (Fat) accurately.

Formatting & Output Rules:
- Split multi-item meals into distinct items inside "items" whenever components are recognizable (e.g. "ข้าวสวย", "อกไก่ย่าง", "ไข่ต้ม" as separate items).
- Match input language naturally: use natural Thai food_name for Thai text/labels, natural English for English inputs, and clean mixed naming when the user mixes languages.
- Keep portion_desc realistic and specific (e.g. "1 จาน (~200g)", "2 ฟอง", "1 scoop (32g)").
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
    temperature: 0.2,
  };

  let rawResponseText: string | undefined;
  const ai = options?.generateContent
    ? null
    : new GoogleGenAI({ apiKey: resolvedApiKey });

  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i];
    const hasNextCandidate = i < candidateModels.length - 1;
    try {
      if (options?.generateContent) {
        const result = await options.generateContent({ model, contents: parts, config });
        rawResponseText = result.text;
      } else if (ai) {
        const result = await ai.models.generateContent({
          model,
          contents: parts,
          config,
        });
        rawResponseText = result.text;
      }
      break;
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
  }

  if (!rawResponseText || !rawResponseText.trim()) {
    throw new AiNutritionError(
      502,
      'INVALID_AI_RESPONSE',
      'Gemini AI returned an empty response. Please try again or switch to Manual mode.',
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = extractJsonPayload(rawResponseText);
  } catch {
    throw new AiNutritionError(
      502,
      'INVALID_AI_RESPONSE',
      'Gemini AI returned malformed JSON. Please try again or switch to Manual mode.',
    );
  }

  const validated = ParseNutritionResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new AiNutritionError(
      502,
      'INVALID_AI_RESPONSE',
      'Gemini AI response did not match the expected nutrition schema. Please retry or switch to Manual mode.',
    );
  }

  return {
    suggested_meal_type: validated.data.suggested_meal_type,
    items: validated.data.items.map((item) => ({
      food_name: item.food_name,
      portion_desc: item.portion_desc,
      calories: Math.max(0, Math.round(item.calories)),
      protein_g: Math.max(0, roundToOneDecimal(item.protein_g)),
      carbs_g: Math.max(0, roundToOneDecimal(item.carbs_g)),
      fat_g: Math.max(0, roundToOneDecimal(item.fat_g)),
      confidence: item.confidence,
    })),
  };
}

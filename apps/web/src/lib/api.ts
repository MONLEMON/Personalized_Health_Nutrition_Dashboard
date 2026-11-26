/// <reference types="vite/client" />
import type {
  AppleHealthWebhookResponse,
  BodyMetricDTO,
  CreateBatchNutritionLogsInput,
  CreateBodyMetricInput,
  CreateNutritionLogInput,
  CreateWorkoutLogInput,
  DashboardBootstrapResponse,
  DashboardTodayResponse,
  MeResponseDTO,
  MetricsTrendsResponse,
  MonthlyCalendarResponse,
  NutritionLogDTO,
  NutritionLogSource,
  OnboardingProfileInput,
  ParseNutritionResponse,
  SyncStatusDTO,
  ToggleSupplementInput,
  UpdateProfileSettingsInput,
  UpdateSupplementsInput,
  UpdateSupplementsResponse,
  WebhookKeyResponse,
  WorkoutLogDTO,
} from '@health-dash/shared';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export interface ApiAuthConfig {
  getAccessToken: () => string | null | Promise<string | null>;
  onUnauthorized: () => void | Promise<void>;
}

let authConfig: ApiAuthConfig = {
  getAccessToken: () => null,
  onUnauthorized: () => {},
};

/**
 * Configures Bearer JWT injection and 401 handling for authenticated API requests.
 */
export function configureApiAuth(config: ApiAuthConfig): void {
  authConfig = config;
}

export function getApiBaseUrl(): string {
  if (API_BASE) {
    return API_BASE;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseApiError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  let code: string | undefined;

  try {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
      code?: string;
    };
    if (typeof body.error === 'string' && body.error.length > 0) {
      message = body.error;
    } else if (typeof body.message === 'string' && body.message.length > 0) {
      message = body.message;
    }
    if (typeof body.code === 'string' && body.code.length > 0) {
      code = body.code;
    }
  } catch {
    // Ignore non-JSON error bodies
  }

  return new ApiError(response.status, message, code);
}

export interface RequestOptions {
  skipAuth?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const AI_PARSE_TIMEOUT_MS = 28_000;

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (!options?.skipAuth) {
    const token = await authConfig.getAccessToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const externalSignal = init?.signal;

  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timeoutId =
    timeoutMs > 0
      ? globalThis.setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      throw new ApiError(
        408,
        'Request timed out. Please check your connection and try again.',
        'TIMEOUT',
      );
    }
    throw err;
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  if (!response.ok) {
    if (!options?.skipAuth && response.status === 401) {
      void authConfig.onUnauthorized();
    }
    throw await parseApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function fetchMe(): Promise<MeResponseDTO> {
  return request<MeResponseDTO>('/api/me');
}

export async function fetchDashboardBootstrap(
  days: number = 30,
): Promise<DashboardBootstrapResponse> {
  return request<DashboardBootstrapResponse>(
    `/api/dashboard/bootstrap?days=${encodeURIComponent(String(days))}`,
  );
}

export async function fetchMonthlyCalendar(month?: string): Promise<MonthlyCalendarResponse> {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return request<MonthlyCalendarResponse>(`/api/dashboard/calendar${query}`);
}

export async function updateSupplementStack(
  input: UpdateSupplementsInput,
): Promise<UpdateSupplementsResponse> {
  return request<UpdateSupplementsResponse>('/api/settings/supplements', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function updateProfileSettings(
  input: UpdateProfileSettingsInput,
): Promise<MeResponseDTO> {
  return request<MeResponseDTO>('/api/settings/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function submitOnboarding(input: OnboardingProfileInput): Promise<MeResponseDTO> {
  return request<MeResponseDTO>('/api/onboarding', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function generatePersonalWebhookKey(): Promise<WebhookKeyResponse> {
  return request<WebhookKeyResponse>('/api/settings/webhook-key', {
    method: 'POST',
  });
}

export async function fetchDashboardToday(date?: string): Promise<DashboardTodayResponse> {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return request<DashboardTodayResponse>(`/api/dashboard/today${query}`);
}

export async function fetchMetricsTrends(days: number = 30): Promise<MetricsTrendsResponse> {
  return request<MetricsTrendsResponse>(`/api/metrics/trends?days=${encodeURIComponent(String(days))}`);
}

export async function createNutritionLog(
  input: CreateNutritionLogInput,
): Promise<NutritionLogDTO> {
  return request<NutritionLogDTO>('/api/nutrition', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteNutritionLog(id: string): Promise<void> {
  return request<void>(`/api/nutrition/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function createWorkoutLog(input: CreateWorkoutLogInput): Promise<WorkoutLogDTO> {
  return request<WorkoutLogDTO>('/api/workouts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteWorkoutLog(id: string): Promise<void> {
  return request<void>(`/api/workouts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export interface ToggleSupplementResponse {
  supplementKey: string;
  taken: boolean;
  loggedDate?: string;
}

export async function toggleSupplement(
  input: ToggleSupplementInput,
): Promise<ToggleSupplementResponse> {
  return request<ToggleSupplementResponse>('/api/supplements/toggle', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createBodyMetric(input: CreateBodyMetricInput): Promise<BodyMetricDTO> {
  return request<BodyMetricDTO>('/api/metrics', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function parseNutritionWithAI(input: {
  text?: string;
  image?: File;
}): Promise<ParseNutritionResponse> {
  const formData = new FormData();
  const trimmedText = input.text?.trim();
  if (trimmedText) {
    formData.append('text', trimmedText);
  }
  if (input.image) {
    formData.append('image', input.image);
  }

  const headers: Record<string, string> = {};
  const token = await authConfig.getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, AI_PARSE_TIMEOUT_MS);

  let response: Response;
  try {
    // Do not manually set Content-Type so the browser generates the multipart boundary
    response = await fetch(`${API_BASE}/api/nutrition/parse`, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      throw new ApiError(
        408,
        'AI analysis timed out (วิเคราะห์นานเกินไป) — Tap Retry AI or switch to Manual mode.',
        'TIMEOUT',
      );
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      void authConfig.onUnauthorized();
    }
    throw await parseApiError(response);
  }

  return (await response.json()) as ParseNutritionResponse;
}

export interface CreateNutritionLogsBatchResponse {
  items: NutritionLogDTO[];
  count: number;
  source: NutritionLogSource;
}

export async function createNutritionLogsBatch(
  input: CreateBatchNutritionLogsInput,
): Promise<CreateNutritionLogsBatchResponse> {
  return request<CreateNutritionLogsBatchResponse>('/api/nutrition/batch', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchWebhookSyncStatus(): Promise<SyncStatusDTO> {
  return request<SyncStatusDTO>('/api/webhooks/status');
}

export async function sendAppleHealthTestSync(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<AppleHealthWebhookResponse> {
  return request<AppleHealthWebhookResponse>(
    '/api/webhooks/apple-health',
    {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    },
    { skipAuth: true },
  );
}

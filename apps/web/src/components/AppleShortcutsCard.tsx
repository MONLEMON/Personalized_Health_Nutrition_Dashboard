import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  SyncStatusDTO,
  WebhookKeyResponse,
  WebhookKeyStatusDTO,
} from '@health-dash/shared';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import {
  ApiError,
  generatePersonalWebhookKey,
  getApiBaseUrl,
  sendAppleHealthTestSync,
} from '../lib/api';
import { BentoCard } from './BentoCard';

export interface AppleShortcutsCardProps {
  syncStatus: SyncStatusDTO;
  onSyncSuccess: () => Promise<void> | void;
  webhookKeyStatus?: WebhookKeyStatusDTO;
  onKeyGenerated?: () => Promise<void> | void;
  recordedDate?: string;
  onClose?: () => void;
  id?: string;
}

type CopyTarget = 'url' | 'header' | 'json' | 'newKey';

function getBangkokTodayDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatBangkokTimestamp(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp;
  }
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(parsed);
  return `${datePart} · ${timePart} ICT`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }

  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export function AppleShortcutsCard({
  syncStatus,
  onSyncSuccess,
  webhookKeyStatus,
  onKeyGenerated,
  recordedDate,
  onClose,
  id,
}: AppleShortcutsCardProps) {
  const apiKeyInputId = useId();
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<WebhookKeyResponse | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const webhookUrl = useMemo(() => {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    return `${base}/api/webhooks/apple-health`;
  }, []);

  const effectiveDate = recordedDate || getBangkokTodayDate();

  const samplePayload = useMemo(
    () => ({
      recorded_date: effectiveDate,
      weight_kg: 74.8,
      body_fat_pct: 0.164,
      skeletal_muscle_kg: 35.7,
      resting_hr: 52,
      sleep_hours: 7.6,
      active_calories: 480,
    }),
    [effectiveDate],
  );

  const sampleJsonString = useMemo(
    () => JSON.stringify(samplePayload, null, 2),
    [samplePayload],
  );

  const savedKeyConfigured = Boolean(webhookKeyStatus?.configured || generatedKey);
  const savedKeyLabel = generatedKey
    ? generatedKey.masked_key
    : webhookKeyStatus?.configured
      ? webhookKeyStatus.masked_key ??
        (webhookKeyStatus.prefix ? `${webhookKeyStatus.prefix}••••••••` : 'hk_live_••••••••')
      : 'No personal key generated yet';

  const headerSnippetPreview = apiKey.trim()
    ? `X-API-Key: ${
        showApiKey ? apiKey.trim() : `${apiKey.trim().slice(0, 12)}••••••••`
      }`
    : savedKeyConfigured
      ? `X-API-Key: ${savedKeyLabel}`
      : 'X-API-Key: <your-personal-webhook-key>';
  const headerSnippetToCopy = `X-API-Key: ${apiKey.trim() || '<your-personal-webhook-key>'}`;

  const handleCopy = async (target: CopyTarget, text: string) => {
    const copied = await copyTextToClipboard(text);
    if (!copied) return;

    setCopiedTarget(target);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedTarget(null);
      copyTimerRef.current = null;
    }, 2000);
  };

  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    setKeyError(null);
    setSyncFeedback(null);

    try {
      const response = await generatePersonalWebhookKey();
      setGeneratedKey(response);
      setApiKey(response.api_key);
      await onKeyGenerated?.();
    } catch (err) {
      setKeyError(
        err instanceof Error ? err.message : 'Failed to generate personal webhook key',
      );
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleSendTestSync = async () => {
    if (!apiKey.trim()) {
      setSyncFeedback({
        type: 'error',
        message: 'Generate or paste your personal hk_live_... webhook key above first.',
      });
      return;
    }

    setSending(true);
    setSyncFeedback(null);

    try {
      const response = await sendAppleHealthTestSync(apiKey.trim(), samplePayload);
      const updatedLabel =
        response.updated_fields.length > 0
          ? response.updated_fields.join(', ')
          : 'no changes';

      setSyncFeedback({
        type: 'success',
        message: `Synced • Dynamic TDEE: ${response.dynamic_tdee.toLocaleString()} kcal · Updated: ${updatedLabel}`,
      });

      await onSyncSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSyncFeedback({
          type: 'error',
          message:
            '401 Unauthorized — Generate or paste your personal hk_live_... webhook key above.',
        });
      } else {
        setSyncFeedback({
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to send test sync to Apple Health webhook',
        });
      }
    } finally {
      setSending(false);
    }
  };

  const isSynced = syncStatus.status === 'SUCCESS' && syncStatus.last_synced_at !== null;

  return (
    <div id={id} className="min-w-0 scroll-mt-4">
      <BentoCard
        title="Apple Shortcuts Integration"
        subtitle="Personal per-user iOS Health webhook"
        icon={<Smartphone className="h-4 w-4 text-[#2EE6A6]" />}
        accentGlow="mint"
        headerRight={
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                isSynced
                  ? 'border-[#2EE6A6]/25 bg-[#2EE6A6]/10 text-[#2EE6A6]'
                  : 'border-white/10 bg-white/[0.04] text-slate-400'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  isSynced ? 'bg-[#2EE6A6]' : 'bg-slate-500'
                }`}
              />
              {isSynced ? 'Connected' : 'Ready'}
            </span>

            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Shortcuts Integration modal"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        }
      >
        <div className="min-w-0 space-y-4">
          {/* Current Sync Status Summary */}
          <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-400">Last synced</span>
              <span className="tabular-nums font-semibold text-white">
                {syncStatus.status === 'SUCCESS' && syncStatus.last_synced_at
                  ? formatBangkokTimestamp(syncStatus.last_synced_at)
                  : 'Never'}
              </span>
            </div>

            {syncStatus.synced_fields.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {syncStatus.synced_fields.map((field) => (
                  <span
                    key={field}
                    className="max-w-full break-all rounded-full border border-[#2EE6A6]/20 bg-[#2EE6A6]/10 px-2 py-0.5 font-mono text-[11px] text-[#2EE6A6]"
                  >
                    {field}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-slate-500">
                No webhook sync recorded yet. Generate your personal key and run a test sync below.
              </p>
            )}
          </div>

          {/* Personal Per-User Webhook Key Manager */}
          <div className="min-w-0 space-y-2.5 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                <ShieldCheck className="h-4 w-4 shrink-0 text-[#2EE6A6]" />
                <span>Personal API Key</span>
              </div>
              <span
                className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
                  savedKeyConfigured
                    ? 'border-[#2EE6A6]/25 bg-[#2EE6A6]/10 text-[#2EE6A6]'
                    : 'border-white/10 bg-white/[0.04] text-slate-400'
                }`}
              >
                {savedKeyLabel}
              </span>
            </div>

            <button
              type="button"
              onClick={() => void handleGenerateKey()}
              disabled={generatingKey}
              className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#2EE6A6]/35 bg-[#2EE6A6]/12 px-4 py-2 text-xs font-bold text-[#2EE6A6] transition hover:bg-[#2EE6A6]/20 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generatingKey ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating Personal Key…</span>
                </>
              ) : savedKeyConfigured ? (
                <>
                  <RefreshCw className="h-4 w-4" />
                  <span>Regenerate API Key</span>
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  <span>Generate Personal API Key</span>
                </>
              )}
            </button>

            {keyError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-[#FF5C6C]/30 bg-[#FF5C6C]/12 px-3 py-2 text-xs text-[#FF8A95]"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF5C6C]" />
                <span className="min-w-0 flex-1 break-words">{keyError}</span>
              </div>
            ) : null}

            {generatedKey ? (
              <div className="min-w-0 space-y-2.5 rounded-2xl border border-[#2EE6A6]/40 bg-[#2EE6A6]/10 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#2EE6A6]">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">
                      Displayed once only — copy this into Apple Shortcuts
                    </span>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch">
                  <div className="flex min-w-0 flex-1 items-center rounded-xl border border-[#2EE6A6]/30 bg-[#0A0C10] px-3 py-2">
                    <code className="break-all font-mono text-xs text-white">
                      {generatedKey.api_key}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy('newKey', generatedKey.api_key)}
                    className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#2EE6A6] px-3.5 py-2 text-xs font-bold text-[#081016] transition hover:brightness-110 active:scale-[0.98]"
                  >
                    {copiedTarget === 'newKey' ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Key</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* 1. Webhook URL */}
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
              <span>Webhook URL</span>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch">
              <div className="flex min-w-0 flex-1 items-center rounded-xl border border-white/10 bg-[#0A0C10] px-3 py-2.5">
                <code className="break-all font-mono text-xs text-slate-200">
                  <span className="mr-1.5 font-semibold text-[#2EE6A6]">POST</span>
                  {webhookUrl}
                </code>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy('url', webhookUrl)}
                className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 active:scale-[0.98]"
              >
                {copiedTarget === 'url' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#2EE6A6]" />
                    <span className="text-[#2EE6A6]">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 2. Header (X-API-Key) */}
          <div className="min-w-0 space-y-2">
            <label
              htmlFor={apiKeyInputId}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-300"
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-[#FFB020]" />
              <span>Header (X-API-Key)</span>
            </label>

            <div className="flex min-w-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  id={apiKeyInputId}
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your hk_live_... personal webhook key"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] py-2 pr-11 pl-3 font-mono text-base text-white outline-none transition placeholder:font-sans placeholder:text-slate-500 focus:border-[#2EE6A6] sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((prev) => !prev)}
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center text-slate-400 transition hover:text-white"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch">
              <div className="flex min-w-0 flex-1 items-center rounded-xl border border-white/10 bg-[#0A0C10] px-3 py-2.5">
                <code className="break-all font-mono text-xs text-slate-300">
                  {headerSnippetPreview}
                </code>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy('header', headerSnippetToCopy)}
                className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 active:scale-[0.98]"
              >
                {copiedTarget === 'header' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#2EE6A6]" />
                    <span className="text-[#2EE6A6]">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Header</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 3. Sample JSON Payload */}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-300">
                Sample JSON Payload
              </span>
              <button
                type="button"
                onClick={() => void handleCopy('json', sampleJsonString)}
                className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 active:scale-[0.98]"
              >
                {copiedTarget === 'json' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#2EE6A6]" />
                    <span className="text-[#2EE6A6]">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>

            <pre className="max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-[#0A0C10] p-3.5 font-mono text-xs leading-relaxed text-slate-200">
              {sampleJsonString}
            </pre>

            <p className="text-[11px] leading-relaxed text-slate-400">
              Apple Shortcuts empty <code className="text-slate-300">&quot;&quot;</code> values
              are safely ignored without overwriting existing records, and decimal{' '}
              <code className="text-slate-300">body_fat_pct</code> ratios like{' '}
              <code className="text-[#2EE6A6]">0.23</code> are automatically normalized to{' '}
              <code className="text-[#2EE6A6]">23%</code>.
            </p>
          </div>

          {/* Feedback Banner */}
          {syncFeedback ? (
            <div
              role={syncFeedback.type === 'error' ? 'alert' : 'status'}
              className={`flex items-start gap-2 rounded-2xl border px-3.5 py-3 text-xs ${
                syncFeedback.type === 'success'
                  ? 'border-[#2EE6A6]/30 bg-[#2EE6A6]/12 text-[#2EE6A6]'
                  : 'border-[#FF5C6C]/30 bg-[#FF5C6C]/12 text-[#FF8A95]'
              }`}
            >
              {syncFeedback.type === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2EE6A6]" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5C6C]" />
              )}
              <span className="min-w-0 flex-1 break-words leading-relaxed font-medium">
                {syncFeedback.message}
              </span>
            </div>
          ) : null}

          {/* 4. Send Test Sync Action */}
          <button
            type="button"
            onClick={() => void handleSendTestSync()}
            disabled={sending}
            className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-4 py-2.5 text-sm font-bold text-[#081016] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:text-xs"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Sending Test Sync…</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span>Send Test Sync</span>
              </>
            )}
          </button>
        </div>
      </BentoCard>
    </div>
  );
}

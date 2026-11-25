import type { SyncStatusDTO } from '@health-dash/shared';

export interface AppleHealthSyncPillProps {
  syncStatus: SyncStatusDTO;
  onClick?: () => void;
  className?: string;
}

function formatBangkokTime24h(isoTimestamp: string): string | null {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(parsed);
}

export function AppleHealthSyncPill({
  syncStatus,
  onClick,
  className = '',
}: AppleHealthSyncPillProps) {
  const formattedTime =
    syncStatus.status === 'SUCCESS' && syncStatus.last_synced_at
      ? formatBangkokTime24h(syncStatus.last_synced_at)
      : null;

  const isSynced = syncStatus.status === 'SUCCESS' && formattedTime !== null;

  const syncedFieldsSummary =
    syncStatus.synced_fields.length > 0
      ? syncStatus.synced_fields.join(', ')
      : 'no fields reported';

  const tooltipTitle = isSynced
    ? `Apple Health synced at ${formattedTime} (Asia/Bangkok) · Fields: ${syncedFieldsSummary}`
    : 'Health Sync off · Click to configure Apple Shortcuts webhook';

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltipTitle}
      aria-label={tooltipTitle}
      className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition active:scale-95 sm:min-h-0 ${
        isSynced
          ? 'border-[#2EE6A6]/25 bg-[#2EE6A6]/10 text-[#2EE6A6] hover:bg-[#2EE6A6]/15'
          : 'border-white/10 bg-[#141720] text-slate-300 hover:border-white/20 hover:bg-white/[0.06]'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${
          isSynced
            ? 'bg-[#2EE6A6] shadow-[0_0_8px_rgba(46,230,166,0.9)]'
            : 'bg-slate-500'
        }`}
      />
      <span className="tabular-nums whitespace-nowrap">
        {isSynced ? `Synced • ${formattedTime}` : 'Health Sync • Off'}
      </span>
    </button>
  );
}

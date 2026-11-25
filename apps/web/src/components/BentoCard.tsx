import type { ReactNode } from 'react';

export interface BentoCardProps {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  headerRight?: ReactNode;
  className?: string;
  bodyClassName?: string;
  accentGlow?: 'mint' | 'amber' | 'coral' | 'sky' | 'none';
  children: ReactNode;
}

const GLOW_CLASSES: Record<NonNullable<BentoCardProps['accentGlow']>, string> = {
  mint: 'from-[#2EE6A6]/12 via-transparent to-transparent',
  amber: 'from-[#FFB020]/12 via-transparent to-transparent',
  coral: 'from-[#FF5C6C]/14 via-transparent to-transparent',
  sky: 'from-[#38BDF8]/12 via-transparent to-transparent',
  none: 'from-white/[0.02] via-transparent to-transparent',
};

export function BentoCard({
  title,
  subtitle,
  icon,
  headerRight,
  className = '',
  bodyClassName = '',
  accentGlow = 'none',
  children,
}: BentoCardProps) {
  const hasHeader = Boolean(title || subtitle || icon || headerRight);

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-white/5 bg-[#141720] p-5 sm:p-6 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)] ${className}`}
    >
      {/* Subtle Apple-native top surface highlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${GLOW_CLASSES[accentGlow]}`}
      />

      <div className={`relative z-10 flex h-full flex-col ${bodyClassName}`}>
        {hasHeader && (
          <header className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {icon && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-200">
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2 className="truncate text-[15px] font-semibold tracking-tight text-white">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="truncate text-xs text-slate-400">{subtitle}</p>
                )}
              </div>
            </div>
            {headerRight && <div className="shrink-0">{headerRight}</div>}
          </header>
        )}

        <div className="flex-1">{children}</div>
      </div>
    </section>
  );
}

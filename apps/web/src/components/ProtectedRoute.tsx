import type { ReactNode } from 'react';
import { AlertCircle, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AuthPage } from './AuthPage';
import { OnboardingWizard } from './OnboardingWizard';

export interface ProtectedRouteProps {
  children: ReactNode;
}

function AuthLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-[#0A0C10] pb-24 pt-[env(safe-area-inset-top)] text-white md:pb-12">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(46,230,166,0.08),transparent_65%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="flex items-center justify-between pb-6">
          <div className="h-9 w-44 animate-pulse rounded-2xl bg-white/10" />
          <div className="h-9 w-36 animate-pulse rounded-full bg-white/10 sm:w-56" />
        </div>
        <div className="h-56 animate-pulse rounded-3xl border border-white/5 bg-[#141720]" />
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-12">
          <div className="h-72 animate-pulse rounded-3xl border border-white/5 bg-[#141720] md:col-span-2 lg:col-span-7" />
          <div className="h-72 animate-pulse rounded-3xl border border-white/5 bg-[#141720] md:col-span-1 lg:col-span-5" />
        </div>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { session, me, authLoading, meLoading, meError, refreshMe, signOut } = useAuth();

  if (authLoading || (session && meLoading && !me)) {
    return <AuthLoadingSkeleton />;
  }

  if (!session) {
    return <AuthPage />;
  }

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0C10] px-4 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/5 bg-[#141720] p-6 text-center shadow-[0_24px_64px_-16px_rgba(0,0,0,0.95)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FF5C6C]/30 bg-[#FF5C6C]/10 text-[#FF5C6C]">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">Unable to Load Profile</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            {meError ?? 'Could not connect to the VitalPulse API server.'}
          </p>
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={() => void refreshMe()}
              className="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-4 py-2.5 text-sm font-bold text-[#081016] transition hover:brightness-110"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!me.onboarded) {
    return <OnboardingWizard />;
  }

  return <>{children}</>;
}

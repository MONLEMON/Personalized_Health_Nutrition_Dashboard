import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type AuthMode = 'signin' | 'signup';

function VitalPulseOrbLogo() {
  return (
    <div className="relative flex h-16 w-16 items-center justify-center">
      <div
        aria-hidden="true"
        className="animate-pulse-aura absolute inset-0 rounded-full bg-[#2EE6A6]/25 blur-xl"
      />
      <svg
        viewBox="0 0 80 80"
        className="relative h-14 w-14 overflow-visible"
        role="img"
        aria-label="VitalPulse biometric orb logo"
      >
        <defs>
          <radialGradient id="auth-orb-grad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
            <stop offset="38%" stopColor="#2EE6A6" stopOpacity="0.96" />
            <stop offset="100%" stopColor="#0FA974" stopOpacity="0.9" />
          </radialGradient>
        </defs>
        <circle
          cx="40"
          cy="40"
          r="35"
          fill="none"
          stroke="#2EE6A6"
          strokeOpacity="0.22"
          strokeWidth="1.25"
        />
        <g className="animate-pulse-orb" style={{ transformOrigin: '40px 40px' }}>
          <circle
            cx="40"
            cy="40"
            r="26"
            fill="url(#auth-orb-grad)"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="1"
          />
          <ellipse
            cx="33"
            cy="28"
            rx="9"
            ry="4.5"
            fill="white"
            fillOpacity="0.22"
            transform="rotate(-22 33 28)"
          />
          <g stroke="#081016" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 29 38 Q 32.5 34.5 36 38" fill="none" strokeWidth="2.2" />
            <path d="M 44 38 Q 47.5 34.5 51 38" fill="none" strokeWidth="2.2" />
            <path d="M 34 45.5 Q 40 50.5 46 45.5" fill="none" strokeWidth="2.2" />
          </g>
        </g>
      </svg>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export function AuthPage() {
  const {
    isConfigured,
    authError,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    clearAuthError,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setLocalError(null);
    setInfoNotice(null);
    clearAuthError();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setInfoNotice(null);
    clearAuthError();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setLocalError('Please enter your email address.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(trimmedEmail, password);
      } else {
        const result = await signUpWithEmail(trimmedEmail, password);
        if (!result.error && result.needsEmailConfirmation) {
          setInfoNotice(
            `Confirmation link sent to ${trimmedEmail}. Please verify your email, then sign in.`,
          );
          setMode('signin');
          setPassword('');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleClick = async () => {
    setLocalError(null);
    setInfoNotice(null);
    clearAuthError();
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } finally {
      setGoogleLoading(false);
    }
  };

  const visibleError = localError ?? authError;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-x-clip bg-[#0A0C10] px-4 py-8 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] text-white">
      {/* Ambient Mint & Sky glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top,rgba(46,230,166,0.14),transparent_65%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 left-1/2 h-80 w-[34rem] -translate-x-1/2 rounded-full bg-[#38BDF8]/8 blur-3xl"
      />

      <div className="relative z-10 w-full min-w-0 max-w-md">
        {/* Brand Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <VitalPulseOrbLogo />
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">VitalPulse</h1>
            <span className="rounded-full border border-[#2EE6A6]/30 bg-[#2EE6A6]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#2EE6A6]">
              Biometric OS
            </span>
          </div>
          <p className="mt-1.5 text-sm text-slate-400">
            Personalized Dynamic TDEE, Macros &amp; Apple Health Sync
          </p>
        </div>

        {/* Main Card */}
        <section className="relative min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-[#141720] p-5 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.95)] sm:p-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#2EE6A6]/8 via-transparent to-transparent"
          />

          <div className="relative z-10 min-w-0 space-y-5">
            {/* Mode Segmented Toggle */}
            <div
              className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/5 bg-[#0A0C10] p-1"
              role="tablist"
              aria-label="Authentication mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                onClick={() => switchMode('signin')}
                className={`min-h-[44px] min-w-0 cursor-pointer rounded-xl px-2 text-sm font-semibold transition ${
                  mode === 'signin'
                    ? 'bg-[#1A1E2A] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                onClick={() => switchMode('signup')}
                className={`min-h-[44px] min-w-0 cursor-pointer rounded-xl px-2 text-sm font-semibold transition ${
                  mode === 'signup'
                    ? 'bg-[#1A1E2A] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Create Account
              </button>
            </div>

            {/* Unconfigured .env Setup Guide */}
            {!isConfigured ? (
              <div className="min-w-0 rounded-2xl border border-[#FFB020]/30 bg-[#FFB020]/10 p-4 text-xs text-amber-100">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-[#FFB020]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-semibold text-[#FFB020]">
                      Supabase Auth Not Configured Yet
                    </p>
                    <p className="leading-relaxed text-slate-300">
                      Add your Supabase project credentials to the root{' '}
                      <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[#2EE6A6]">
                        .env
                      </code>{' '}
                      file and restart Vite:
                    </p>
                    <pre className="max-w-full overflow-x-auto rounded-xl border border-white/10 bg-[#0A0C10] p-2.5 font-mono text-[11px] leading-relaxed text-slate-200">
                      {`VITE_SUPABASE_URL=https://your-project.supabase.co\nVITE_SUPABASE_ANON_KEY=your-supabase-anon-key`}
                    </pre>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Info / Verification Banner */}
            {infoNotice ? (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-2xl border border-[#2EE6A6]/30 bg-[#2EE6A6]/12 px-3.5 py-3 text-xs text-[#2EE6A6]"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2EE6A6]" />
                <span className="min-w-0 flex-1 break-words leading-relaxed font-medium">
                  {infoNotice}
                </span>
              </div>
            ) : null}

            {/* Error Banner */}
            {visibleError ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-2xl border border-[#FF5C6C]/30 bg-[#FF5C6C]/12 px-3.5 py-3 text-xs text-[#FF8A95]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5C6C]" />
                <span className="min-w-0 flex-1 break-words leading-relaxed font-medium">
                  {visibleError}
                </span>
              </div>
            ) : null}

            {/* Google OAuth Button */}
            <button
              type="button"
              onClick={() => void handleGoogleClick()}
              disabled={!isConfigured || googleLoading || submitting}
              className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.09] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {googleLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#2EE6A6]" />
              ) : (
                <GoogleIcon />
              )}
              <span>Continue with Google</span>
            </button>

            <div className="relative flex items-center py-0.5">
              <div className="flex-grow border-t border-white/10" />
              <span className="mx-3 shrink-0 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                or email
              </span>
              <div className="flex-grow border-t border-white/10" />
            </div>

            {/* Email / Password Form */}
            <form onSubmit={(e) => void handleSubmit(e)} className="min-w-0 space-y-4">
              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-300">Email</span>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={!isConfigured || submitting}
                    className="min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] py-2 pr-3 pl-10 text-base text-white outline-none transition placeholder:text-slate-600 focus:border-[#2EE6A6] disabled:opacity-50 sm:text-sm"
                  />
                </div>
              </label>

              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-300">Password</span>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                    disabled={!isConfigured || submitting}
                    className="min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] py-2 pr-11 pl-10 text-base text-white outline-none transition placeholder:text-slate-600 focus:border-[#2EE6A6] disabled:opacity-50 sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center text-slate-400 transition hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              <button
                type="submit"
                disabled={!isConfigured || submitting || googleLoading}
                className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-4 py-2.5 text-sm font-bold text-[#081016] shadow-[0_0_24px_rgba(46,230,166,0.22)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{mode === 'signin' ? 'Signing In…' : 'Creating Account…'}</span>
                  </>
                ) : (
                  <span>{mode === 'signin' ? 'Sign In to VitalPulse' : 'Create Account'}</span>
                )}
              </button>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1 text-center text-[11px] text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#2EE6A6]" />
              <span>Private multi-user biometric vault · JWT protected</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

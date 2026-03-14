'use client';

import { FormEvent, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase-client';

interface ResetFormErrors {
  password?: string;
  confirmPassword?: string;
  form?: string;
}

type RecoveryState = 'loading' | 'ready' | 'invalid';

function getTokenFromHash() {
  if (typeof window === 'undefined') {
    return null;
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const type = hashParams.get('type');

  if (!accessToken || !refreshToken) {
    return null;
  }

  if (type && type !== 'recovery') {
    return null;
  }

  return { accessToken, refreshToken };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('loading');
  const [recoveryMessage, setRecoveryMessage] = useState('Validating reset link...');
  const [isSubmitting, startSubmitTransition] = useTransition();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<ResetFormErrors>({});
  const searchParamKey = searchParams?.toString() ?? '';

  useEffect(() => {
    let active = true;

    async function initializeRecoverySession() {
      setRecoveryState('loading');
      setRecoveryMessage('Validating reset link...');
      const supabase = getSupabaseBrowserClient();
      const code = new URLSearchParams(searchParamKey).get('code');

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (!active) {
          return;
        }

        if (error) {
          setRecoveryState('invalid');
          setRecoveryMessage('The reset link is invalid or expired. Request a new password reset email.');
          return;
        }

        if (typeof window !== 'undefined') {
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        setRecoveryState('ready');
        setRecoveryMessage('');
        return;
      }

      const hashToken = getTokenFromHash();
      if (!hashToken) {
        setRecoveryState('invalid');
        setRecoveryMessage('The reset link is invalid or expired. Request a new password reset email.');
        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token: hashToken.accessToken,
        refresh_token: hashToken.refreshToken
      });

      if (!active) {
        return;
      }

      if (error) {
        setRecoveryState('invalid');
        setRecoveryMessage('Could not establish a recovery session. Request a new password reset email.');
        return;
      }

      if (typeof window !== 'undefined') {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      setRecoveryState('ready');
      setRecoveryMessage('');
    }

    void initializeRecoverySession();

    return () => {
      active = false;
    };
  }, [searchParamKey]);

  function validatePasswordForm() {
    const nextErrors: ResetFormErrors = {};

    if (!password) {
      nextErrors.password = 'New password is required.';
    } else if (password.length < 12) {
      nextErrors.password = 'Password must be at least 12 characters.';
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = 'Confirm your new password.';
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    return nextErrors;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validatePasswordForm();

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    startSubmitTransition(async () => {
      setErrors({});
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setErrors({
          form: error.message
        });
        return;
      }

      await supabase.auth.signOut();
      router.replace('/login');
      router.refresh();
    });
  }

  if (recoveryState === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-3 py-24 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-600" aria-hidden="true" />
        <p className="text-sm text-slate-700">{recoveryMessage}</p>
      </div>
    );
  }

  if (recoveryState === 'invalid') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 py-20">
        <h2 className="text-3xl font-semibold text-slate-900">Reset link not valid</h2>
        <p className="text-sm leading-6 text-slate-600">{recoveryMessage}</p>
        <Link
          href="/login"
          className="focus-ring inline-flex w-fit rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Return to login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center">
      <div className="mb-8">
        <p className="eyebrow">Password Recovery</p>
        <h2 className="mt-3 text-3xl font-semibold text-slate-900">Set a new password</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Choose a strong password you have not used before for this workspace.
        </p>
      </div>

      {errors.form ? (
        <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errors.form}
        </p>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <label htmlFor="new-password" className="text-sm font-medium text-slate-800">
            New password
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'new-password-error' : undefined}
            className={errors.password ? 'border-rose-400 focus-visible:ring-rose-500' : ''}
            required
          />
          {errors.password ? (
            <p id="new-password-error" className="text-sm text-rose-700">
              {errors.password}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm-password" className="text-sm font-medium text-slate-800">
            Confirm new password
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
            className={errors.confirmPassword ? 'border-rose-400 focus-visible:ring-rose-500' : ''}
            required
          />
          {errors.confirmPassword ? (
            <p id="confirm-password-error" className="text-sm text-rose-700">
              {errors.confirmPassword}
            </p>
          ) : null}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Updating password...
            </>
          ) : (
            'Update password'
          )}
        </Button>
      </form>
    </div>
  );
}

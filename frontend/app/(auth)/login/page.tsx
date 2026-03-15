'use client';

import React, { Suspense, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient, type AuthError } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getRememberMePreference,
  getSupabaseBrowserClient,
  setRememberMePreference
} from '@/lib/supabase-client';

interface LoginFormErrors {
  email?: string;
  password?: string;
  form?: string;
  reset?: string;
}

let authClient: ReturnType<typeof createClient> | null = null;

function getEnvValue(value: string | undefined, key: string) {
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }

  return value;
}

function getAuthClient() {
  if (authClient) {
    return authClient;
  }

  const supabaseUrl = getEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const supabaseAnonKey = getEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );

  authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return authClient;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeRedirectPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/dashboard';
  }

  return value;
}

function getFriendlyAuthError(error: AuthError) {
  const message = error.message.toLowerCase();

  if (message.includes('invalid login credentials')) {
    return 'Invalid email or password. Verify your credentials and try again.';
  }

  if (message.includes('email not confirmed')) {
    return 'Your email address is not confirmed. Check your inbox before signing in.';
  }

  return error.message;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = normalizeRedirectPath(searchParams?.get('redirectTo') ?? null);
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [isSendingReset, startResetTransition] = useTransition();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(getRememberMePreference);
  const [errors, setErrors] = useState<LoginFormErrors>({});

  function validateForm() {
    const nextErrors: LoginFormErrors = {};

    if (!email.trim()) {
      nextErrors.email = 'Email is required.';
    } else if (!isValidEmail(email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Password is required.';
    }

    return nextErrors;
  }

  function handleSubmit(event: React.BaseSyntheticEvent) {
    event.preventDefault();
    const nextErrors = validateForm();

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    startSubmitTransition(async () => {
      setErrors({});
      setRememberMePreference(rememberMe);

      const client = getAuthClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        setErrors({
          form: getFriendlyAuthError(error)
        });
        return;
      }

      const session = data.session;
      if (!session) {
        setErrors({
          form: 'Authentication succeeded but no active session was returned. Please try again.'
        });
        return;
      }

      const browserSupabase = getSupabaseBrowserClient();
      const { error: setSessionError } = await browserSupabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });

      if (setSessionError) {
        setErrors({
          form: 'Could not establish a browser session. Please retry.'
        });
        return;
      }

      router.replace(redirectTo);
      router.refresh();
    });
  }

  function handleForgotPassword() {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrors({
        reset: 'Enter your email first, then select Forgot password?.'
      });
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setErrors({
        reset: 'Enter a valid email to receive reset instructions.'
      });
      return;
    }

    startResetTransition(async () => {
      const client = getAuthClient();
      const redirectToUrl = `${window.location.origin}/reset-password`;
      const { error } = await client.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: redirectToUrl
      });

      if (error) {
        setErrors({
          reset: error.message
        });
        return;
      }

      setErrors({
        reset: 'Password reset instructions sent. Check your inbox.'
      });
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center">
      <div className="mb-8">
        <p className="eyebrow">Secure Sign In</p>
        <h2 className="mt-3 text-3xl font-semibold text-slate-900">Access Atlas Treasury</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Sign in with your corporate credentials to continue to treasury operations.
        </p>
      </div>

      {errors.form ? (
        <div
          role="alert"
          aria-live="polite"
          className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {errors.form}
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-slate-800">
            Work email
          </label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'email-error' : undefined}
            placeholder="you@company.com"
            className={errors.email ? 'border-rose-400 focus-visible:ring-rose-500' : ''}
            required
          />
          {errors.email ? (
            <p id="email-error" className="text-sm text-rose-700">
              {errors.email}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-slate-800">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : undefined}
            placeholder="Enter your password"
            className={errors.password ? 'border-rose-400 focus-visible:ring-rose-500' : ''}
            required
          />
          {errors.password ? (
            <p id="password-error" className="text-sm text-rose-700">
              {errors.password}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="focus-ring h-4 w-4 rounded border-slate-300 text-slate-900"
            />
            Remember me for 30 days
          </label>
          <button
            type="button"
            onClick={handleForgotPassword}
            className="focus-ring rounded text-sm font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
            disabled={isSendingReset}
          >
            Forgot password?
          </button>
        </div>

        {errors.reset ? (
          <p
            role="status"
            aria-live="polite"
            className={`text-sm ${errors.reset.includes('sent') ? 'text-emerald-700' : 'text-rose-700'}`}
          >
            {errors.reset}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Signing in...
            </>
          ) : (
            'Sign in'
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          className="focus-ring rounded font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
        >
          Create one
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-slate-500">
        By continuing you agree to your organization&apos;s treasury access and security policy.
      </p>

      <div className="mt-4 text-center">
        <Link href="/" className="focus-ring rounded text-sm font-medium text-slate-600 hover:text-slate-900">
          Back to platform overview
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

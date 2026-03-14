'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient, type AuthError } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient, setRememberMePreference } from '@/lib/supabase-client';

interface SignupFormErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  form?: string;
}

let authClient: ReturnType<typeof createClient> | null = null;

function getAuthClient() {
  if (authClient) return authClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables.');
  }

  authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  return authClient;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getFriendlyError(error: AuthError) {
  const msg = error.message.toLowerCase();
  if (msg.includes('already registered') || msg.includes('already exists')) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (msg.includes('password')) {
    return 'Password must be at least 8 characters.';
  }
  return error.message;
}

export default function SignupPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<SignupFormErrors>({});
  const [successMessage, setSuccessMessage] = useState('');

  function validate(): SignupFormErrors {
    const e: SignupFormErrors = {};

    if (!fullName.trim()) {
      e.fullName = 'Full name is required.';
    } else if (fullName.trim().length < 2) {
      e.fullName = 'Enter your full name.';
    }

    if (!email.trim()) {
      e.email = 'Work email is required.';
    } else if (!isValidEmail(email.trim())) {
      e.email = 'Enter a valid email address.';
    }

    if (!password) {
      e.password = 'Password is required.';
    } else if (password.length < 8) {
      e.password = 'Password must be at least 8 characters.';
    } else if (!/[A-Z]/.test(password)) {
      e.password = 'Include at least one uppercase letter.';
    } else if (!/[0-9]/.test(password)) {
      e.password = 'Include at least one number.';
    }

    if (!confirmPassword) {
      e.confirmPassword = 'Please confirm your password.';
    } else if (password !== confirmPassword) {
      e.confirmPassword = 'Passwords do not match.';
    }

    return e;
  }

  function handleSubmit(event: React.BaseSyntheticEvent) {
    event.preventDefault();
    const nextErrors = validate();

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    startTransition(async () => {
      setErrors({});
      setSuccessMessage('');

      const client = getAuthClient();
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/login`
        }
      });

      if (error) {
        setErrors({ form: getFriendlyError(error) });
        return;
      }

      // If email confirmation is disabled in Supabase, session is returned immediately
      if (data.session) {
        setRememberMePreference(true);
        const browserClient = getSupabaseBrowserClient();
        await browserClient.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        });
        router.replace('/dashboard');
        router.refresh();
        return;
      }

      // Email confirmation required
      setSuccessMessage(
        `Account created! Check ${email.trim()} for a confirmation link before signing in.`
      );
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center">
      <div className="mb-8">
        <p className="eyebrow">Get Started</p>
        <h2 className="mt-3 text-3xl font-semibold text-slate-900">Create your account</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Set up your Atlas Treasury workspace to get started.
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

      {successMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          {successMessage}
        </div>
      ) : null}

      {!successMessage ? (
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {/* Full Name */}
          <div className="space-y-2">
            <label htmlFor="fullName" className="text-sm font-medium text-slate-800">
              Full name
            </label>
            <Input
              id="fullName"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={errors.fullName ? 'fullName-error' : undefined}
              placeholder="Jane Smith"
              className={errors.fullName ? 'border-rose-400 focus-visible:ring-rose-500' : ''}
            />
            {errors.fullName ? (
              <p id="fullName-error" className="text-sm text-rose-700">{errors.fullName}</p>
            ) : null}
          </div>

          {/* Email */}
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
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              placeholder="you@company.com"
              className={errors.email ? 'border-rose-400 focus-visible:ring-rose-500' : ''}
            />
            {errors.email ? (
              <p id="email-error" className="text-sm text-rose-700">{errors.email}</p>
            ) : null}
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-slate-800">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'password-error' : 'password-hint'}
              placeholder="Min. 8 characters"
              className={errors.password ? 'border-rose-400 focus-visible:ring-rose-500' : ''}
            />
            {errors.password ? (
              <p id="password-error" className="text-sm text-rose-700">{errors.password}</p>
            ) : (
              <p id="password-hint" className="text-xs text-slate-500">
                At least 8 characters with one uppercase letter and one number.
              </p>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-800">
              Confirm password
            </label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={errors.confirmPassword ? 'confirm-error' : undefined}
              placeholder="Re-enter your password"
              className={errors.confirmPassword ? 'border-rose-400 focus-visible:ring-rose-500' : ''}
            />
            {errors.confirmPassword ? (
              <p id="confirm-error" className="text-sm text-rose-700">{errors.confirmPassword}</p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating account...
              </>
            ) : (
              'Create account'
            )}
          </Button>
        </form>
      ) : (
        <Link href="/login">
          <Button className="w-full">Go to sign in</Button>
        </Link>
      )}

      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link
          href="/login"
          className="focus-ring rounded font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
        >
          Sign in
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-slate-500">
        By creating an account you agree to your organization&apos;s treasury access and security policy.
      </p>
    </div>
  );
}

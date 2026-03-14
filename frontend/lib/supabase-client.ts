import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parse, serialize, type SerializeOptions } from 'cookie';

const REMEMBER_ME_STORAGE_KEY = 'atlas-treasury.remember-me';
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

let supabaseBrowserClient: SupabaseClient | null = null;

function getSupabaseEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. Expected NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

function shouldPersistForThirtyDays() {
  return getRememberMePreference();
}

export function getRememberMePreference() {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY) !== 'false';
}

export function setRememberMePreference(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(REMEMBER_ME_STORAGE_KEY, String(value));
}

function serializeCookie(name: string, value: string, options: SerializeOptions) {
  return serialize(name, value, options);
}

export function getSupabaseBrowserClient() {
  if (supabaseBrowserClient) {
    return supabaseBrowserClient;
  }

  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();

  supabaseBrowserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    isSingleton: true,
    auth: {
      flowType: 'pkce'
    },
    cookies: {
      getAll() {
        if (typeof document === 'undefined') {
          return [];
        }

        const parsedCookies = parse(document.cookie ?? '');
        return Object.entries(parsedCookies).flatMap(([name, value]) => {
          return typeof value === 'string' ? [{ name, value }] : [];
        });
      },
      setAll(cookiesToSet) {
        if (typeof document === 'undefined') {
          return;
        }

        const shouldPersist = shouldPersistForThirtyDays();

        cookiesToSet.forEach(({ name, value, options }) => {
          const isCookieRemoval = options.maxAge === 0 || value === '';
          const nextOptions: SerializeOptions = { ...options };

          if (!isCookieRemoval) {
            if (shouldPersist) {
              nextOptions.maxAge = THIRTY_DAYS_IN_SECONDS;
            } else {
              delete nextOptions.maxAge;
              delete nextOptions.expires;
            }
          }

          document.cookie = serializeCookie(name, value, nextOptions);
        });
      }
    }
  });

  return supabaseBrowserClient;
}

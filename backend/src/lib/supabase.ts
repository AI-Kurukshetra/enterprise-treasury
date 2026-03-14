import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '@/config/env';

export function createAnonSupabaseClient(): SupabaseClient {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false
    }
  });
}

export function createServiceSupabaseClient(): SupabaseClient {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
}

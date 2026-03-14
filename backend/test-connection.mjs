import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env.local manually
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');

try {
  const envFile = readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
} catch {
  console.error('❌ Could not read .env.local — make sure it exists at the project root');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n🔍 Checking environment variables...');
console.log('  SUPABASE_URL      :', url ? '✅ found' : '❌ missing');
console.log('  ANON_KEY          :', anonKey ? '✅ found' : '❌ missing');
console.log('  SERVICE_ROLE_KEY  :', serviceKey ? '✅ found' : '❌ missing');

if (!url || !anonKey) {
  console.error('\n❌ Missing required env vars. Check your .env.local\n');
  process.exit(1);
}

// Test anon client
console.log('\n🔗 Testing anon client connection...');
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const { error: anonError } = await anon.from('_test_ping').select('*').limit(1);

const tableNotFound = anonError?.message?.includes('schema cache') || anonError?.code === '42P01';
if (tableNotFound) {
  console.log('  ✅ Anon client connected (DB is reachable)');
} else if (anonError) {
  console.error('  ❌ Anon client error:', anonError.message);
} else {
  console.log('  ✅ Anon client connected successfully');
}

// Test service role client
if (serviceKey) {
  console.log('\n🔗 Testing service role client connection...');
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error: svcError } = await service.from('_test_ping').select('*').limit(1);

  if (svcError?.code === '42P01') {
    console.log('  ✅ Service role client connected (table not found is OK — DB is reachable)');
  } else if (svcError) {
    console.error('  ❌ Service role error:', svcError.message);
  } else {
    console.log('  ✅ Service role client connected successfully');
  }
}

console.log('\n✅ Connection test complete!\n');

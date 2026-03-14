import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const envPath = resolve(repoRoot, '.env.local');
const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error('Usage: node ./scripts/run-with-root-env.mjs <command> [...args]');
  process.exit(1);
}

const env = { ...process.env };
const envFile = readFileSync(envPath, 'utf8');

for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    continue;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex === -1) {
    continue;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

// Keep non-essential integrations from blocking local audit boot.
env.ANTHROPIC_API_KEY ||= 'test-anthropic-key-for-runtime';
env.ALLOWED_ORIGINS ||=
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001';

const child = spawn(command, args, {
  cwd: resolve(repoRoot, 'backend'),
  env,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const summaryPath = resolve(process.cwd(), 'coverage/coverage-summary.json');
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));

const globalThresholds = {
  lines: 80,
  statements: 80,
  functions: 80,
  branches: 75
};

const criticalFiles = {
  'src/services/payments/service.ts': 90,
  'src/services/transactions/service.ts': 90,
  'src/services/approvals/service.ts': 90,
  'src/middleware/organizationContextMiddleware.ts': 90,
  'src/utils/money.ts': 95
};

function assertThreshold(label, actual, required) {
  if (actual < required) {
    throw new Error(`${label} coverage ${actual}% is below required ${required}%`);
  }
}

for (const [metric, required] of Object.entries(globalThresholds)) {
  assertThreshold(`global ${metric}`, summary.total[metric].pct, required);
}

for (const [file, required] of Object.entries(criticalFiles)) {
  const fileSummary = summary[file] ?? summary[resolve(process.cwd(), file)];
  if (!fileSummary) {
    throw new Error(`Coverage summary missing critical file ${file}`);
  }
  assertThreshold(`${file} lines`, fileSummary.lines.pct, required);
}

console.log('Coverage thresholds satisfied.');

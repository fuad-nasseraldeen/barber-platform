import type { InvariantSuiteResult } from '../invariants/types';

export function printInvariantReport(r: InvariantSuiteResult): void {
  console.log('\n=== BOOKING INVARIANT REPORT ===');
  console.log('checkedAt:', r.checkedAt);
  console.log('businessId:', r.businessId ?? '(all)');

  if (r.violations.length === 0) {
    console.log('RESULT: OK — 0 violations');
    console.log('================================\n');
    return;
  }

  const errors = r.violations.filter((v) => v.severity === 'error');
  const warnings = r.violations.filter((v) => v.severity === 'warn');

  console.log(`violations: ${r.violations.length} (${errors.length} errors, ${warnings.length} warnings)`);
  console.log('');

  for (const v of r.violations) {
    const prefix = v.severity === 'error' ? 'ERROR' : 'WARN';
    console.error(`  [${prefix}] ${v.code}: ${v.message}`);
    if (v.detail) {
      console.error(`         ${JSON.stringify(v.detail)}`);
    }
  }

  console.log(`\nRESULT: ${errors.length > 0 ? 'FAIL' : 'WARN'}`);
  console.log('================================\n');
}

export function exitFromResult(r: InvariantSuiteResult): never {
  const hasErrors = r.violations.some((v) => v.severity === 'error');
  process.exit(hasErrors ? 1 : 0);
}

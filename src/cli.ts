#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validate } from './index.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('usage: cius-pt [--json] <invoice.xml> [more.xml ...]');
  process.exit(2);
}
let failed = 0;
for (const file of files) {
  const result = validate(readFileSync(file, 'utf8'));
  if (json) {
    console.log(JSON.stringify({ file, ...result }, null, 2));
  } else {
    console.log(`${result.valid ? 'PASS' : 'FAIL'} ${file}  ${result.documentType ?? 'unknown'}  ${result.errors.length} errors, ${result.warnings.length} warnings`);
    for (const f of result.errors) console.log(`  ✗ ${f.id}  ${f.message}\n    at ${f.location}`);
    for (const f of result.warnings) console.log(`  ! ${f.id}  ${f.message}\n    at ${f.location}`);
    if (result.coverage.unsupported.length > 0) console.log(`  ? ${result.coverage.unsupported.length} assertions could not be evaluated (see --json)`);
  }
  if (!result.valid) failed += 1;
}
if (!json) console.log(`${files.length} document${files.length === 1 ? '' : 's'}: ${files.length - failed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);

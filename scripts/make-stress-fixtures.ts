/** Writes fixtures/stress/lines-<n>.xml for each line count given. Usage: npx tsx scripts/make-stress-fixtures.ts 50 500 2000 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStressInvoice } from './stress-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'fixtures', 'stress');
mkdirSync(out, { recursive: true });
for (const arg of process.argv.slice(2)) {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1) throw new Error(`not a line count: ${arg}`);
  const file = join(out, `lines-${n}.xml`);
  const xml = makeStressInvoice(n);
  writeFileSync(file, xml);
  console.log(`${file}: ${n} lines, ${(xml.length / 1024).toFixed(0)} KB`);
}

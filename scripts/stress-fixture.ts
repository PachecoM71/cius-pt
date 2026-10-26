/**
 * Builds large CIUS-PT invoices from eSPap's F_e.xml by cloning its single
 * line, so engine and eSPap's validator can be compared at scale.
 *
 * What the rules actually require (read from src/rules/cius-pt-2.1.1.ts, not assumed):
 * - DT-CIUS-PT-117.1: quantity matches ^-?\d{1,13}\.\d{2,3}$ (two or three decimals).
 * - DT-CIUS-PT-127.1: unit price matches ^\d{1,13}\.\d{2,8}$ (two to eight decimals).
 * - DT-CIUS-PT-157: with a BaseQuantity > 0 (F_e has 1.00), round(qty * price / base * 100) div 100
 *   must be within 1.00 of LineExtensionAmount.
 * - DT-CIUS-PT-160/163/164/165/166/167/173/174: every sum and VAT relation has the same
 *   acceptance range of 1.00.
 * Money is computed in BigInt thousandths and rounded half up to cents, which is
 * what XPath round() does for positive numbers, so the fixture is exact and any
 * disagreement points at the engine.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_PATH = join(here, '..', 'fixtures', 'espap-2.1.1', 'F_e.xml');

const toCents = (thousandths: bigint): bigint => (thousandths + 5n) / 10n;
const money = (cents: bigint): string => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
const price3 = (thousandths: bigint): string => `${thousandths / 1000n}.${String(thousandths % 1000n).padStart(3, '0')}`;

/** Replace exactly one occurrence and throw if the pattern did not match, so a silent miss cannot produce a bad fixture. */
function replaceOnce(input: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(input)) throw new Error(`stress fixture: no match for ${what}`);
  return input.replace(pattern, replacement);
}

export function makeStressInvoice(lineCount: number): string {
  const src = readFileSync(SAMPLE_PATH, 'utf8');
  const lineMatch = src.match(/<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/);
  if (!lineMatch || lineMatch.index === undefined) throw new Error('F_e.xml has no InvoiceLine');
  if ((src.match(/<cac:InvoiceLine>/g) ?? []).length !== 1) throw new Error('expected exactly one InvoiceLine in F_e.xml');
  const template = lineMatch[0];
  const head = src.slice(0, lineMatch.index);
  const tail = src.slice(lineMatch.index + template.length);

  let lines = '';
  let totalCents = 0n;
  for (let i = 1; i <= lineCount; i += 1) {
    const qty = BigInt(1 + (i % 7));
    const unitThousandths = 1000n + BigInt((i * 37) % 999); // 1.000 to 1.998, three decimals on purpose
    const extensionCents = toCents(qty * unitThousandths);   // base quantity in F_e is 1.00
    totalCents += extensionCents;
    let line = template;
    line = replaceOnce(line, /<cbc:ID>[^<]*<\/cbc:ID>/, `<cbc:ID>${i}</cbc:ID>`, 'line id');
    line = replaceOnce(line, /<cbc:Note>[^<]*<\/cbc:Note>/, `<cbc:Note>Linha ${i}</cbc:Note>`, 'line note');
    line = replaceOnce(line, /(<cbc:InvoicedQuantity[^>]*>)[^<]*/, `$1${qty}.00`, 'quantity');
    line = replaceOnce(line, /(<cbc:LineExtensionAmount[^>]*>)[^<]*/, `$1${money(extensionCents)}`, 'line amount');
    line = replaceOnce(line, /(<cbc:PriceAmount[^>]*>)[^<]*/, `$1${price3(unitThousandths)}`, 'price');
    lines += line;
  }
  const taxable = totalCents;
  const tax = (taxable * 23n + 50n) / 100n; // 23 percent, rounded half up to cents
  const total = taxable + tax;
  let doc = head + lines + tail;
  doc = replaceOnce(doc, /(<cac:TaxTotal>\s*<cbc:TaxAmount[^>]*>)[^<]*/, `$1${money(tax)}`, 'TaxTotal/TaxAmount');
  doc = replaceOnce(doc, /(<cac:TaxSubtotal>\s*<cbc:TaxableAmount[^>]*>)[^<]*/, `$1${money(taxable)}`, 'TaxSubtotal/TaxableAmount');
  doc = replaceOnce(doc, /(<cac:TaxSubtotal>[\s\S]*?<cbc:TaxAmount[^>]*>)[^<]*/, `$1${money(tax)}`, 'TaxSubtotal/TaxAmount');
  doc = replaceOnce(doc, /(<cac:LegalMonetaryTotal>\s*<cbc:LineExtensionAmount[^>]*>)[^<]*/, `$1${money(taxable)}`, 'LegalMonetaryTotal/LineExtensionAmount');
  doc = replaceOnce(doc, /(<cbc:TaxExclusiveAmount[^>]*>)[^<]*/, `$1${money(taxable)}`, 'TaxExclusiveAmount');
  doc = replaceOnce(doc, /(<cbc:TaxInclusiveAmount[^>]*>)[^<]*/, `$1${money(total)}`, 'TaxInclusiveAmount');
  doc = replaceOnce(doc, /(<cbc:PayableAmount[^>]*>)[^<]*/, `$1${money(total)}`, 'PayableAmount');
  return doc;
}

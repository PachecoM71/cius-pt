/**
 * Dev tool: compare this package's findings with eSPap's public validator, the
 * service behind https://svc.feap.gov.pt/Doc.Client/public/CIUSvalidation/PT.
 * It posts the whole document to eSPap, so use it only on documents you may
 * share, and sparingly: it is a public web page's backend, not an API with
 * terms for automation. eSPap runs the UBL XSD before the Schematron, so a
 * datatype mistake comes back as SYNTAX_ERROR there and as a DT-CIUS-PT rule
 * here; that difference is expected.
 *
 * Usage: npx tsx scripts/compare-espap.ts fixtures/espap-2.1.1/F_e.xml [more.xml ...]
 */
import { readFileSync } from 'node:fs';
import { validate } from '../src/index.js';

const API = 'https://svc.feap.gov.pt/Doc.WebApi.Services/api/ValidateDocumentFormat/country';

interface EspapEntry {
  Code: string;
  Field?: string;
  Values?: string[];
}
interface EspapResponse {
  IsValid: boolean;
  Errors?: EspapEntry[];
  Data?: EspapEntry[] | null;
}

for (const file of process.argv.slice(2)) {
  const xml = readFileSync(file, 'utf8');
  const ours = validate(xml);
  const documentType = ours.documentType === 'CreditNote' ? 'CREDIT_NOTE' : 'INVOICE';
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      Country: 'PT',
      DocumentType: documentType,
      SerializedDocument: { ContentType: 'application/xml', Name: 'noName.xml', ContentData: xml },
    }),
  });
  if (!res.ok) {
    console.log(`${file}: eSPap answered HTTP ${res.status}`);
    continue;
  }
  const body = (await res.json()) as EspapResponse;
  const theirs = (body.Data ?? []).map((e) => e.Code);
  const mine = [...ours.errors, ...ours.warnings].map((f) => f.id);
  const onlyTheirs = theirs.filter((c) => !mine.includes(c));
  const onlyMine = mine.filter((c) => !theirs.includes(c));
  const requestErrors = body.Errors?.length ? ` (request errors: ${body.Errors.map((e) => e.Code).join(', ')})` : '';
  console.log(file);
  console.log(`  eSPap:   ${theirs.length === 0 ? 'valid' : theirs.join(', ')}${requestErrors}`);
  console.log(`  cius-pt: ${mine.length === 0 ? 'valid' : mine.join(', ')}`);
  console.log(`  ${onlyTheirs.length === 0 && onlyMine.length === 0 ? 'AGREE' : `DIFFER: only eSPap ${JSON.stringify(onlyTheirs)}; only cius-pt ${JSON.stringify(onlyMine)}`}`);
}

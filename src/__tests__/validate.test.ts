import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_BYTES, SPECIFICATION_ASSERTIONS, validate } from '../index.js';
import { isContextIndependent, nodePath } from '../schematron/engine.js';
import { schema } from '../rules/cius-pt-2.1.1.js';
import { createRequire } from 'node:module';
import { makeStressInvoice } from '../../scripts/stress-fixture.js';
import type { Node } from 'slimdom';

const require = createRequire(import.meta.url);
const { evaluateXPath, evaluateXPathToNodes } = require('fontoxpath') as typeof import('fontoxpath');
import { parseXmlDocument } from 'slimdom';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'espap-2.1.1');
const samples = readdirSync(FIXTURES).filter((f) => f.endsWith('.xml')).sort();
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const ids = (findings: { id: string }[]) => findings.map((f) => f.id);

describe('eSPap sample documents', () => {
  it('ships fifteen samples', () => {
    expect(samples).toHaveLength(15);
  });

  it.each(samples)('%s passes every rule with full coverage', (name) => {
    const result = validate(read(name));
    expect(result.documentType).toBe(name === 'NC.xml' ? 'CreditNote' : 'Invoice');
    expect(result.customizationId).toContain('urn:feap.gov.pt:CIUS-PT:');
    expect(ids(result.errors)).toEqual([]);
    expect(ids(result.warnings)).toEqual([]);
    expect(result.coverage.unsupported).toEqual([]);
    expect(result.coverage.assertionsInSpecification).toBe(SPECIFICATION_ASSERTIONS);
    expect(result.coverage.assertionsEvaluated).toBeGreaterThan(800);
    expect(result.valid).toBe(true);
  });

  it('compiled 1,155 assertions from the specification', () => {
    expect(SPECIFICATION_ASSERTIONS).toBe(1155);
  });
});

describe('defects are reported with eSPap rule ids', () => {
  const base = read('F_e.xml');

  it('wrong issue date format: DT-CIUS-PT-002', () => {
    const result = validate(base.replace('<cbc:IssueDate>2019-02-28</cbc:IssueDate>', '<cbc:IssueDate>28-02-2019</cbc:IssueDate>'));
    expect(result.valid).toBe(false);
    expect(ids(result.errors)).toContain('DT-CIUS-PT-002');
    expect(result.errors.find((f) => f.id === 'DT-CIUS-PT-002')?.location).toBe('/Invoice[1]/cbc:IssueDate[1]');
  });

  it('invoice type code outside the allowed list: DT-CIUS-PT-003', () => {
    const result = validate(base.replace(/<cbc:InvoiceTypeCode>[^<]*<\/cbc:InvoiceTypeCode>/, '<cbc:InvoiceTypeCode>999</cbc:InvoiceTypeCode>'));
    expect(result.valid).toBe(false);
    expect(ids(result.errors).some((id) => id.startsWith('DT-CIUS-PT-003'))).toBe(true);
  });

  it('empty invoice number: DT-CIUS-PT-001', () => {
    const result = validate(base.replace(/<cbc:ID>[^<]*<\/cbc:ID>/, '<cbc:ID></cbc:ID>'));
    expect(result.valid).toBe(false);
    expect(ids(result.errors)).toContain('DT-CIUS-PT-001');
  });

  it('foreign customization id: DT-CIUS-PT-022', () => {
    const result = validate(base.replace(/urn:feap\.gov\.pt:CIUS-PT:[^<]*/, 'urn:example:other'));
    expect(ids(result.errors)).toContain('DT-CIUS-PT-022');
  });

  it('a skeleton invoice fails the EN 16931 base rules', () => {
    const result = validate(
      '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>1</cbc:ID></Invoice>',
    );
    expect(result.documentType).toBe('Invoice');
    expect(ids(result.errors)).toEqual(expect.arrayContaining(['BR-01', 'BR-03', 'BR-04', 'BR-05']));
  });

  it('a credit note with the wrong type code fails DT-CIUS-PT-003_cn', () => {
    const nc = read('NC.xml');
    expect(nc).toMatch(/<cbc:CreditNoteTypeCode>/);
    const result = validate(nc.replace(/<cbc:CreditNoteTypeCode>[^<]*<\/cbc:CreditNoteTypeCode>/, '<cbc:CreditNoteTypeCode>380</cbc:CreditNoteTypeCode>'));
    expect(ids(result.errors)).toContain('DT-CIUS-PT-003_cn');
  });
});

describe('documents that are not CIUS-PT at all', () => {
  it('reports malformed XML without throwing', () => {
    const result = validate('not xml at all');
    expect(result.valid).toBe(false);
    expect(result.documentType).toBeNull();
    expect(result.errors[0]?.id).toBe('XML');
    expect(result.coverage.assertionsEvaluated).toBe(0);
  });

  it('reports a root element that is not an Invoice or CreditNote', () => {
    const result = validate('<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"/>');
    expect(result.documentType).toBeNull();
    expect(result.errors[0]?.id).toBe('ROOT');
    expect(result.errors[0]?.message).toContain('Order');
  });
});

describe('size guard', () => {
  it('refuses a document above maxBytes before parsing', () => {
    const result = validate('<a/>'.repeat(100), { maxBytes: 16 });
    expect(result.errors[0]?.id).toBe('SIZE');
    expect(result.coverage.assertionsEvaluated).toBe(0);
  });

  it('defaults to a limit that still fits the attachment rule', () => {
    expect(DEFAULT_MAX_BYTES).toBeGreaterThan(6_826_666);
  });
});

describe('isContextIndependent', () => {
  it('accepts absolute-path expressions', () => {
    expect(isContextIndependent("count(//ubl:Invoice/cac:InvoiceLine/cbc:ID | //cn:CreditNote/cac:CreditNoteLine/cbc:ID) = count(distinct-values(//ubl:Invoice/cac:InvoiceLine/cbc:ID))")).toBe(true);
    // the dot and the at-sign sit inside a predicate and a string literal, so the whole expression is still a document constant
    expect(isContextIndependent("count(//ubl:Invoice/cbc:Note[matches(.,'^(#(SOURCECURRENCYCODE)#(.{1,})#)$')])")).toBe(true);
    expect(isContextIndependent("count(//ubl:Invoice/cac:InvoiceLine/cac:Item/cac:AdditionalItemProperty/cbc:Name[matches(.,'^(#(TAXEXEMPTIONREASONCODE@CLASSIFIEDTAXCATEGORY)#)$')])")).toBe(true);
  });

  it('rejects anything that touches the context node', () => {
    expect(isContextIndependent('string-length(.) >= 1')).toBe(false);
    expect(isContextIndependent('exists(cbc:ID)')).toBe(false);
    expect(isContextIndependent('normalize-space(@currencyID) = $bt05')).toBe(false);
    expect(isContextIndependent('count(ancestor::ubl:Invoice/cbc:Note)')).toBe(false);
    expect(isContextIndependent('cac:Price/cbc:PriceAmount >= 0')).toBe(false);
    expect(isContextIndependent('xs:decimal(cbc:TaxAmount) = 1.00')).toBe(false);
  });

  it('does not mistake decimals or hyphenated function names for context references', () => {
    expect(isContextIndependent('count(//ubl:Invoice/cac:InvoiceLine) > 0.00')).toBe(true);
    expect(isContextIndependent('count(distinct-values(//ubl:Invoice/cac:InvoiceLine/cbc:ID)) = 1')).toBe(true);
  });
});

describe('independence claim, checked empirically', () => {
  it('every expression classified independent gives the same value from the root and from a deep node', () => {
    const doc = parseXmlDocument(read('F.xml'));
    const options = { namespaceResolver: (p: string) => schema.namespaces[p] ?? null, language: evaluateXPath.XPATH_3_1_LANGUAGE };
    const deep = evaluateXPathToNodes<Node>('//ubl:Invoice/cac:InvoiceLine[1]/cac:Item/cbc:Name', doc as unknown as Node, null, {}, options)[0];
    expect(deep).toBeDefined();
    const expressions = new Set<string>();
    for (const p of schema.patterns) for (const r of p.rules) {
      for (const l of r.lets) if (isContextIndependent(l.value)) expressions.add(l.value);
      for (const a of r.assertions) if (isContextIndependent(a.test)) expressions.add(a.test);
    }
    expect(expressions.size).toBeGreaterThan(20);
    const evaluate = (expr: string, ctx: Node) => {
      try {
        return JSON.stringify(evaluateXPath(expr, ctx, null, {}, evaluateXPath.ANY_TYPE, options));
      } catch (e) {
        return `throws:${String(e).slice(0, 60)}`;
      }
    };
    const mismatches = [...expressions].filter((expr) => evaluate(expr, doc as unknown as Node) !== evaluate(expr, deep!));
    expect(mismatches).toEqual([]);
  });
});

describe('rules whose context is a match pattern', () => {
  const base = read('F_e.xml');

  it('a line without an invoiced quantity fails BR-22', () => {
    const result = validate(base.replace(/<cbc:InvoicedQuantity[^>]*>[^<]*<\/cbc:InvoicedQuantity>/, ''));
    expect(ids(result.errors)).toContain('BR-22');
  });

  it('a line without an item net price fails BR-26', () => {
    const result = validate(base.replace(/<cbc:PriceAmount[^>]*>[^<]*<\/cbc:PriceAmount>/, ''));
    expect(ids(result.errors)).toContain('BR-26');
  });

  it('a line amount far from quantity times price fails DT-CIUS-PT-157', () => {
    const result = validate(base.replace(/(<cac:InvoiceLine>[\s\S]*?<cbc:LineExtensionAmount[^>]*>)[^<]*/, '$199.99'));
    expect(ids(result.errors)).toContain('DT-CIUS-PT-157');
  });
});

describe('generated stress invoice', () => {
  it('a 50-line invoice with exact totals is valid with full coverage', () => {
    const xml = makeStressInvoice(50);
    expect((xml.match(/<cac:InvoiceLine>/g) ?? []).length).toBe(50);
    const result = validate(xml);
    expect(ids(result.errors)).toEqual([]);
    expect(ids(result.warnings)).toEqual([]);
    expect(result.coverage.unsupported).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('breaking one line total by more than the 1.00 tolerance fails DT-CIUS-PT-157 and the sum rule', () => {
    const xml = makeStressInvoice(5).replace(/(<cac:InvoiceLine>[\s\S]*?<cbc:LineExtensionAmount[^>]*>)[^<]*/, '$1999.99');
    const result = validate(xml);
    expect(ids(result.errors)).toEqual(expect.arrayContaining(['DT-CIUS-PT-157', 'DT-CIUS-PT-160']));
  });
});

describe('nodePath', () => {
  it('numbers same-named siblings', () => {
    const doc = parseXmlDocument('<a xmlns:p="urn:x"><p:b/><p:b><c/></p:b></a>');
    const c = doc.documentElement!.lastChild!.firstChild!;
    expect(nodePath(c)).toBe('/a[1]/p:b[2]/c[1]');
  });
});

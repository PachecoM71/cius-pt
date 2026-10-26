import { parseXmlDocument, type Document, type Element, type Node } from 'slimdom';
import { runSchema, type Finding } from './schematron/engine.js';
import { schema } from './rules/cius-pt-2.1.1.js';

export type { Finding } from './schematron/engine.js';

export interface ValidateOptions {
  /**
   * Reject documents larger than this many bytes before parsing, so a caller
   * exposed to uploads cannot be made to parse something enormous. The default
   * leaves room for the 6,826,666-character attachment limit in DT-CIUS-PT-111.
   */
  maxBytes?: number;
}

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export interface ValidationResult {
  /** True when no fatal finding fired and the document was parsed. */
  valid: boolean;
  /** "Invoice" or "CreditNote", or null when the root element is neither. */
  documentType: 'Invoice' | 'CreditNote' | null;
  customizationId: string | null;
  errors: Finding[];
  warnings: Finding[];
  coverage: {
    specification: string;
    /** Assertions in eSPap's Schematron for the active phase. */
    assertionsInSpecification: number;
    /** Assertions actually evaluated against this document. */
    assertionsEvaluated: number;
    /** Assertions the engine could not evaluate, with the engine error. Empty means full coverage. */
    unsupported: { id: string; test: string; error: string }[];
    /** What this package does not check at all. */
    notChecked: string[];
  };
}

const UBL_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const UBL_CREDIT_NOTE = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

export const SPECIFICATION_ASSERTIONS = schema.patterns.reduce((n, p) => n + p.rules.reduce((m, r) => m + r.assertions.length, 0), 0);

const NOT_CHECKED = [
  'XML Schema (UBL 2.1 XSD) structural validation',
  'Digital signatures (XAdES) and certificates',
  'Transmission to FE-AP, AS2 or REST',
  'SAF-T, ATCUD and QR code rules (certified invoicing software territory)',
];

export function parseDocument(xml: string): Document {
  return parseXmlDocument(xml);
}

function childText(el: Element, namespace: string, localName: string): string | null {
  for (const n of Array.from(el.childNodes) as Node[]) {
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    if (c.namespaceURI === namespace && c.localName === localName) return c.textContent;
  }
  return null;
}

function failure(id: string, message: string): ValidationResult {
  return {
    valid: false,
    documentType: null,
    customizationId: null,
    errors: [{ id, flag: 'fatal', message, location: '/', pattern: 'parse' }],
    warnings: [],
    coverage: { specification: schema.name, assertionsInSpecification: SPECIFICATION_ASSERTIONS, assertionsEvaluated: 0, unsupported: [], notChecked: NOT_CHECKED },
  };
}

/** Validate one CIUS-PT 2.1.1 document (UBL 2.1 Invoice or CreditNote) against eSPap's own rules. */
export function validate(xml: string, options: ValidateOptions = {}): ValidationResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const size = Buffer.byteLength(xml, 'utf8');
  if (size > maxBytes) return failure('SIZE', `Document is ${size} bytes, above the ${maxBytes} byte limit.`);
  let doc: Document;
  try {
    doc = parseDocument(xml);
  } catch (e) {
    return failure('XML', `Not well-formed XML: ${e instanceof Error ? e.message : String(e)}`);
  }
  const root = doc.documentElement;
  const documentType =
    root?.namespaceURI === UBL_INVOICE && root.localName === 'Invoice'
      ? 'Invoice'
      : root?.namespaceURI === UBL_CREDIT_NOTE && root.localName === 'CreditNote'
        ? 'CreditNote'
        : null;
  const errors: Finding[] = [];
  if (documentType === null) {
    errors.push({
      id: 'ROOT',
      flag: 'fatal',
      message: `The root element must be a UBL 2.1 Invoice or CreditNote; found ${root ? `{${root.namespaceURI ?? ''}}${root.localName}` : 'nothing'}.`,
      location: '/',
      pattern: 'parse',
    });
  }
  const customizationId = root ? childText(root, CBC, 'CustomizationID') : null;
  const run = runSchema(schema, doc);
  errors.push(...run.findings.filter((f) => f.flag === 'fatal'));
  const warnings = run.findings.filter((f) => f.flag === 'warning');
  return {
    valid: errors.length === 0,
    documentType,
    customizationId,
    errors,
    warnings,
    coverage: {
      specification: schema.name,
      assertionsInSpecification: SPECIFICATION_ASSERTIONS,
      assertionsEvaluated: run.evaluated,
      unsupported: run.unsupported,
      notChecked: NOT_CHECKED,
    },
  };
}

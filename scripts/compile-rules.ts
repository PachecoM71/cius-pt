/**
 * Compiles eSPap's Schematron files into src/rules/<name>.ts.
 *
 * Handles what the CIUS-PT files use: <include>, abstract patterns instantiated
 * with <pattern is-a> and <param> substitution, pattern- and rule-level <let>,
 * <assert> and <report>, and the phase that activates all patterns.
 *
 * Usage: npx tsx scripts/compile-rules.ts spec/cius-pt-2.1.1/schematron/urn_feap.gov.pt_CIUS-PT_2.1.1.sch "CIUS-PT 2.1.1" src/rules/cius-pt-2.1.1.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseXmlDocument, type Document, type Element, type Node } from 'slimdom';
import type { CompiledAssertion, CompiledLet, CompiledPattern, CompiledRule, CompiledSchema } from '../src/schematron/types.js';

const SCH = 'http://purl.oclc.org/dsdl/schematron';

const [, , rootFile, schemaName, outFile] = process.argv;
if (!rootFile || !schemaName || !outFile) {
  console.error('usage: compile-rules <root.sch> <name> <out.ts>');
  process.exit(2);
}

const rootDir = dirname(resolve(rootFile));

function load(path: string): Document {
  return parseXmlDocument(readFileSync(path, 'utf8'));
}

function children(el: Element, local: string): Element[] {
  const out: Element[] = [];
  for (const n of Array.from(el.childNodes) as Node[]) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === SCH && (n as Element).localName === local) out.push(n as Element);
  }
  return out;
}

function text(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function substitute(expr: string, params: Record<string, string>): string {
  let out = expr;
  for (const name of Object.keys(params).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\$${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_.\\-])`, 'g'), params[name]!);
  }
  return out;
}


/**
 * eSPap checks field lengths with `matches(x,'^(.{a,b})$')`. A JavaScript
 * regex engine expands the counted repetition and takes minutes on a base64
 * attachment (the limit there is 6,826,666 characters). The equivalent
 * string-length test is exact: in XPath regex, `.` excludes newline and
 * carriage return unless the 's' flag is set, and `^...$` anchor the whole
 * string. The rewrite keeps that distinction and needs no flags argument.
 */
function rewriteLengthMatches(expr: string): string {
  const re = /matches\(\s*([^,()]+(?:\([^()]*\))?)\s*,\s*'\^\(\.\{(\d+),(\d*)\}\)\$'\s*(?:,\s*'([a-z]*)')?\s*\)/g;
  return expr.replace(re, (_m, arg: string, min: string, max: string, flags: string | undefined) => {
    const a = arg.trim();
    const parts = [`string-length(${a}) >= ${min}`];
    if (max !== '') parts.push(`string-length(${a}) <= ${max}`);
    if (!(flags ?? '').includes('s')) {
      parts.push(`not(contains(${a}, codepoints-to-string(10)))`, `not(contains(${a}, codepoints-to-string(13)))`);
    }
    return `(${parts.join(' and ')})`;
  });
}

/**
 * A Schematron rule context is a match pattern, not a path from the root:
 * `cac:InvoiceLine` matches every such element anywhere in the document.
 * Evaluated as XPath from the document node it would match only children of
 * the root, so every top-level alternative that does not start with "/" is
 * prefixed with "//". Alternatives are split on "|" outside brackets only.
 */
function normalizeContext(context: string): string {
  const alternatives: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of context) {
    if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth -= 1;
    if (ch === '|' && depth === 0) {
      alternatives.push(current);
      current = '';
    } else current += ch;
  }
  alternatives.push(current);
  return alternatives
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .map((a) => (a.startsWith('/') ? a : `//${a}`))
    .join(' | ');
}

/**
 * A UBL 2.1 Invoice or CreditNote document has exactly one root element of
 * that name, so `ancestor::ubl:Invoice` from any node is that root and equals
 * `//ubl:Invoice`. The rewrite makes the expression independent of the context
 * node, which lets the engine evaluate it once per document instead of once
 * per node (the eSPap rules count notes and item properties this way).
 */
function rewriteRootAncestors(expr: string): string {
  return expr.replace(/ancestor::ubl:Invoice(?=[\/\s)\]|])/g, '//ubl:Invoice').replace(/ancestor::cn:CreditNote(?=[\/\s)\]|])/g, '//cn:CreditNote');
}

function lets(el: Element, params: Record<string, string>): CompiledLet[] {
  return children(el, 'let').map((l) => ({ name: l.getAttribute('name') ?? '', value: rewriteRootAncestors(rewriteLengthMatches(substitute(l.getAttribute('value') ?? '', params))) }));
}

function compileRule(rule: Element, params: Record<string, string>): CompiledRule {
  const assertions: CompiledAssertion[] = [];
  for (const n of Array.from(rule.childNodes) as Node[]) {
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.namespaceURI !== SCH || (el.localName !== 'assert' && el.localName !== 'report')) continue;
    const flag = el.getAttribute('flag') === 'warning' ? 'warning' : 'fatal';
    assertions.push({
      kind: el.localName as 'assert' | 'report',
      id: el.getAttribute('id') ?? '',
      flag,
      test: rewriteRootAncestors(rewriteLengthMatches(substitute(el.getAttribute('test') ?? '', params))),
      message: text(el),
    });
  }
  return { context: normalizeContext(rewriteLengthMatches(substitute(rule.getAttribute('context') ?? '', params))), lets: lets(rule, params), assertions };
}

const rootDoc = load(rootFile);
const root = rootDoc.documentElement!;
const namespaces: Record<string, string> = {};
for (const ns of children(root, 'ns')) namespaces[ns.getAttribute('prefix') ?? ''] = ns.getAttribute('uri') ?? '';

// Gather every pattern reachable through includes, keeping document order.
const abstractPatterns = new Map<string, Element>();
const concretePatterns: Element[] = [];
function collect(el: Element) {
  if (el.namespaceURI === SCH && el.localName === 'pattern') {
    if (el.getAttribute('abstract') === 'true') abstractPatterns.set(el.getAttribute('id') ?? '', el);
    else concretePatterns.push(el);
    return;
  }
  for (const n of Array.from(el.childNodes) as Node[]) {
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    if (c.namespaceURI === SCH && c.localName === 'include') {
      const href = c.getAttribute('href') ?? '';
      const includedPath = resolve(rootDir, href);
      collect(load(includedPath).documentElement!);
    } else collect(c);
  }
}
collect(root);

// Which patterns are active: the phase named "all_phase" if present, else every concrete pattern.
const phases = children(root, 'phase');
const allPhase = phases.find((p) => p.getAttribute('id') === 'all_phase');
const active = allPhase ? new Set(children(allPhase, 'active').map((a) => a.getAttribute('pattern') ?? '')) : null;

const patterns: CompiledPattern[] = [];
for (const pat of concretePatterns) {
  const id = pat.getAttribute('id') ?? '';
  if (active && !active.has(id)) continue;
  const isA = pat.getAttribute('is-a');
  const params: Record<string, string> = {};
  for (const p of children(pat, 'param')) params[p.getAttribute('name') ?? ''] = p.getAttribute('value') ?? '';
  const source = isA ? abstractPatterns.get(isA) : pat;
  if (!source) throw new Error(`abstract pattern ${isA} not found for ${id}`);
  patterns.push({ id, lets: lets(source, params), rules: children(source, 'rule').map((r) => compileRule(r, params)) });
}

const schema: CompiledSchema = { name: schemaName, namespaces, patterns };
const leftover = patterns.flatMap((p) => p.rules.flatMap((r) => [r.context, ...r.lets.map((l) => l.value), ...r.assertions.map((a) => a.test)])).filter((e) => /matches\([^']*'\^\(\.\{/.test(e));
if (leftover.length > 0) throw new Error(`${leftover.length} length regexes were not rewritten; the first is: ${leftover[0]}`);
const count = patterns.reduce((n, p) => n + p.rules.reduce((m, r) => m + r.assertions.length, 0), 0);
const header = `// Generated by scripts/compile-rules.ts from ${rootFile}. Do not edit by hand.\n// ${count} assertions in ${patterns.length} patterns.\nimport type { CompiledSchema } from '../schematron/types.js';\n\nexport const schema: CompiledSchema = `;
writeFileSync(outFile, header + JSON.stringify(schema, null, 1) + ';\n');
console.log(`${outFile}: ${patterns.map((p) => `${p.id}=${p.rules.length} rules`).join(', ')}, ${count} assertions`);

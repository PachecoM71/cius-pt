import { createRequire } from 'node:module';

// fontoxpath ships a CommonJS bundle without an exports map, so a plain ESM
// named import fails under Node. Requiring it explicitly behaves the same in
// Node, tsx, vitest and the tsup output.
const require = createRequire(import.meta.url);
const { evaluateXPath, evaluateXPathToBoolean, evaluateXPathToNodes } = require('fontoxpath') as typeof import('fontoxpath');
import type { Document, Element, Node } from 'slimdom';
import type { CompiledLet, CompiledSchema } from './types.js';

export interface Finding {
  id: string;
  flag: 'fatal' | 'warning';
  message: string;
  /** Position-based XPath of the node the rule fired on. */
  location: string;
  pattern: string;
}

export interface EngineResult {
  findings: Finding[];
  /** Assertions whose XPath could not be evaluated by the engine, with the error. These count as not covered. */
  unsupported: { id: string; test: string; error: string }[];
  evaluated: number;
}

type Vars = Record<string, unknown>;

const PREFIXES = ['ubl', 'cn', 'cbc', 'cac', 'ext', 'qdt', 'udt'];

/** Text inside quotes is not XPath; blank it so a "." or "@" in a literal is not read as a context reference. */
function stripLiterals(expr: string): string {
  return expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

/** Inside a predicate the context is the step being filtered, never the rule's context node, so predicate bodies are irrelevant to independence. */
function stripPredicates(expr: string): string {
  let out = '';
  let depth = 0;
  for (const ch of expr) {
    if (ch === '[') {
      depth += 1;
      if (depth === 1) out += '[';
      continue;
    }
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) out += ']';
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

/**
 * True when an XPath expression cannot depend on the context node: outside
 * string literals and predicates there is no `.`, no `@`, no axis specifier,
 * no variable, and every element step starts with a slash. Such an expression
 * has the same value for every node of a document, so the engine evaluates it
 * once. The check stays conservative; what it cannot prove is evaluated per node.
 * The test suite verifies the claim empirically on a real document.
 */
export function isContextIndependent(expr: string): boolean {
  const e = stripPredicates(stripLiterals(expr));
  if (/\$/.test(e)) return false;
  if (/@/.test(e)) return false;
  if (/::/.test(e)) return false;
  if (/(^|[^\w.])\.(?![\w.])/.test(e)) return false;
  const step = new RegExp(`(^|[^/\\w:])(${PREFIXES.join('|')}):`);
  if (step.test(e)) return false;
  return true;
}

function xpathOptions(namespaces: Record<string, string>) {
  return {
    namespaceResolver: (prefix: string) => namespaces[prefix] ?? null,
    language: evaluateXPath.XPATH_3_1_LANGUAGE,
  };
}

/** /Invoice[1]/cac:InvoiceLine[3]/cbc:ID[1], using the document's own prefixes where it has them. */
export function nodePath(node: Node): string {
  const parts: string[] = [];
  let current: Node | null = node;
  while (current && current.nodeType === 1) {
    const el = current as Element;
    let index = 1;
    let sib: Node | null = el.previousSibling;
    while (sib) {
      if (sib.nodeType === 1) {
        const s = sib as Element;
        if (s.localName === el.localName && s.namespaceURI === el.namespaceURI) index += 1;
      }
      sib = sib.previousSibling;
    }
    parts.unshift(`${el.prefix ? `${el.prefix}:` : ''}${el.localName}[${index}]`);
    current = el.parentNode;
  }
  return `/${parts.join('/')}`;
}

function evaluateLets(lets: CompiledLet[], context: Node, inherited: Vars, options: ReturnType<typeof xpathOptions>, cache: Map<string, unknown>): Vars {
  const vars: Vars = { ...inherited };
  for (const l of lets) {
    if (isContextIndependent(l.value)) {
      if (!cache.has(l.value)) cache.set(l.value, evaluateXPath(l.value, context, null, vars, evaluateXPath.ANY_TYPE, options));
      vars[l.name] = cache.get(l.value);
    } else {
      vars[l.name] = evaluateXPath(l.value, context, null, vars, evaluateXPath.ANY_TYPE, options);
    }
  }
  return vars;
}

/**
 * Why not an existing Schematron package: the npm implementations run on XPath
 * 1.0 engines and cannot evaluate what these files use (matches, every/some,
 * xs: constructors, let variables), so this is a small engine over fontoxpath.
 *
 * ISO Schematron semantics as the CIUS-PT files need them: patterns run
 * independently; inside a pattern a node is handled by the first rule whose
 * context matches it and ignored by later rules; an assert fires when its test
 * is false, a report when its test is true.
 */
export function runSchema(schema: CompiledSchema, doc: Document): EngineResult {
  const options = xpathOptions(schema.namespaces);
  const findings: Finding[] = [];
  const unsupported: EngineResult['unsupported'] = [];
  let evaluated = 0;
  /** Values of context-independent lets and tests, computed once per document. */
  const cache = new Map<string, unknown>();

  for (const pattern of schema.patterns) {
    const patternVars = evaluateLets(pattern.lets, doc as unknown as Node, {}, options, cache);
    const taken = new Set<Node>();
    for (const rule of pattern.rules) {
      let nodes: Node[];
      try {
        nodes = evaluateXPathToNodes<Node>(rule.context, doc as unknown as Node, null, patternVars, options);
      } catch (e) {
        unsupported.push({ id: `context:${rule.context}`, test: rule.context, error: String(e) });
        continue;
      }
      for (const node of nodes) {
        if (taken.has(node)) continue;
        taken.add(node);
        let vars: Vars;
        try {
          vars = evaluateLets(rule.lets, node, patternVars, options, cache);
        } catch (e) {
          unsupported.push({ id: `let@${rule.context}`, test: rule.lets.map((l) => l.value).join('; '), error: String(e) });
          continue;
        }
        for (const a of rule.assertions) {
          let result: boolean;
          try {
            if (isContextIndependent(a.test)) {
              if (!cache.has(a.test)) cache.set(a.test, evaluateXPathToBoolean(a.test, node, null, vars, options));
              result = cache.get(a.test) as boolean;
            } else {
              result = evaluateXPathToBoolean(a.test, node, null, vars, options);
            }
            evaluated += 1;
          } catch (e) {
            unsupported.push({ id: a.id, test: a.test, error: String(e) });
            continue;
          }
          const fired = a.kind === 'assert' ? !result : result;
          if (fired) findings.push({ id: a.id, flag: a.flag, message: a.message, location: nodePath(node), pattern: pattern.id });
        }
      }
    }
  }
  return { findings, unsupported, evaluated };
}

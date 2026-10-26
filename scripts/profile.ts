/** Dev tool: where does validation time go? Usage: npx tsx scripts/profile.ts fixtures/espap-2.1.1/F.xml */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseXmlDocument, type Node } from 'slimdom';
import { schema } from '../src/rules/cius-pt-2.1.1.js';
import { isContextIndependent } from '../src/schematron/engine.js';

const require = createRequire(import.meta.url);
const { evaluateXPath, evaluateXPathToBoolean, evaluateXPathToNodes } = require('fontoxpath') as typeof import('fontoxpath');

const file = process.argv[2]!;
const doc = parseXmlDocument(readFileSync(file, 'utf8'));
const options = { namespaceResolver: (p: string) => schema.namespaces[p] ?? null, language: evaluateXPath.XPATH_3_1_LANGUAGE };
const cache = new Map<string, unknown>();
const rows: { pattern: string; context: string; nodes: number; contextMs: number; assertMs: number; asserts: number }[] = [];
const t0 = performance.now();
for (const pattern of schema.patterns) {
  const pt = performance.now();
  const patternVars: Record<string, unknown> = {};
  for (const l of pattern.lets) patternVars[l.name] = evaluateXPath(l.value, doc as unknown as Node, null, patternVars, evaluateXPath.ANY_TYPE, options);
  const taken = new Set<Node>();
  for (const rule of pattern.rules) {
    const c0 = performance.now();
    let nodes: Node[] = [];
    try { nodes = evaluateXPathToNodes<Node>(rule.context, doc as unknown as Node, null, patternVars, options); } catch { /* counted as unsupported elsewhere */ }
    const c1 = performance.now();
    let asserts = 0;
    for (const node of nodes) {
      if (taken.has(node)) continue;
      taken.add(node);
      const vars: Record<string, unknown> = { ...patternVars };
      try { for (const l of rule.lets) { if (isContextIndependent(l.value)) { if (!cache.has(l.value)) cache.set(l.value, evaluateXPath(l.value, node, null, vars, evaluateXPath.ANY_TYPE, options)); vars[l.name] = cache.get(l.value); } else vars[l.name] = evaluateXPath(l.value, node, null, vars, evaluateXPath.ANY_TYPE, options); } } catch { continue; }
      for (const a of rule.assertions) { try { if (isContextIndependent(a.test)) { if (!cache.has(a.test)) cache.set(a.test, evaluateXPathToBoolean(a.test, node, null, vars, options)); } else evaluateXPathToBoolean(a.test, node, null, vars, options); asserts += 1; } catch { /* skip */ } }
    }
    rows.push({ pattern: pattern.id, context: rule.context, nodes: nodes.length, contextMs: c1 - c0, assertMs: performance.now() - c1, asserts });
  }
  console.log(`pattern ${pattern.id}: ${(performance.now() - pt).toFixed(0)} ms`);
}
console.log(`total ${(performance.now() - t0).toFixed(0)} ms, rules ${rows.length}`);
rows.sort((a, b) => b.contextMs + b.assertMs - (a.contextMs + a.assertMs));
console.log('slowest rules:');
for (const r of rows.slice(0, 12)) console.log(`  ${(r.contextMs + r.assertMs).toFixed(0).padStart(6)} ms  ctx ${r.contextMs.toFixed(0).padStart(5)} ms  asserts ${r.assertMs.toFixed(0).padStart(6)} ms  nodes ${String(r.nodes).padStart(4)}  evaluated ${String(r.asserts).padStart(5)}  [${r.pattern}] ${r.context.slice(0, 90)}`);

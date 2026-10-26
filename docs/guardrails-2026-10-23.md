# Change guardrails report, 23 Oct 2026

Mode: change review. The repository has no commits, so every line is an added line and the whole tree was read, except `src/rules/cius-pt-2.1.1.ts`, which is generated from eSPap's Schematron by `scripts/compile-rules.ts` and is excluded from lint.

## Not checked

- XML Schema validation (the UBL 2.1 XSD). By design and documented in the README; eSPap runs it before the Schematron, so a datatype mistake is a schema error there and a DT-CIUS-PT rule here.
- Decimal arithmetic parity with Saxon. The engine evaluates `xs:decimal` on JavaScript numbers. The fifteen eSPap samples and four spot checks against eSPap's public validator agree, but no fixture stresses rounding at scale.
- Warnings. No sample produces a `warning`-flagged finding, so the warning path is exercised only by code review.
- `eslint-plugin-security` and `eslint-plugin-no-unsanitized` are absent. The package evaluates fixed XPath over untrusted XML; there is no HTML and no shell.
- Gates 3 and 4 (accessibility, React): no UI.
- Gate 7 (architecture): no written rules and fewer than ten source files.
- Gate 9 (SEO, production readiness): a library and a CLI, no web surface. `package.json` still has `private: true`, so it cannot be published by accident.
- Windows: paths and line endings untested; fixtures use LF.

## Counts

- ESLint: 0 errors, 0 warnings across 9 files; rule sets active: typescript-eslint 20, core 4.
- tsc (TypeScript 6.0.3): 0 errors.
- Tests: 28 passed, including all fifteen eSPap samples with full coverage, six mutations with expected rule ids, malformed XML, a non-invoice root, the size guard, and `nodePath`.
- Build: tsup ESM plus declarations; the main chunk is 544 KB, almost all the rule table.
- Advisories: 0 in the full tree, 0 in production. 2 packages run install scripts.
- Suppressions in added lines: none. Casts: `doc as unknown as Node` twice in the engine and once in the profiler, because slimdom's `Document` type is not assignable to fontoxpath's `Node`; `as Element` after `nodeType === 1` checks.
- Hostile input: a six-level entity expansion bomb is rejected by the parser in about 250 ms with a clear message; an external entity declaration is ignored; a byte-order mark before the prolog is accepted; documents above 25 MB are refused before parsing.
- Oracle: eSPap's public validator, 23 Oct 2026. `F_e.xml` and `NC.xml` valid on both sides; `F_e.xml` with type code 999 reports `DT-CIUS-PT-003_i` on both sides; `F_e.xml` with date `28-02-2019` is an XSD `SYNTAX_ERROR` at eSPap and `DT-CIUS-PT-002` plus `DT-CIUS-PT-024` here.

## Findings

1. [6 med] `src/schematron/engine.ts`: sum rules in the EN 16931 base (`BR-CO-10` to `BR-CO-16`) compare decimals with `=`, and the engine computes them as JavaScript doubles. Input: an invoice whose line amounts only balance under exact decimal arithmetic, for example many lines at three decimals. Wrong outcome: a false fatal, or a missed one. Fix: add fixtures with hundreds of lines and awkward amounts and compare with eSPap through `scripts/compare-espap.ts`; if any differ, evaluate those assertions through a decimal library.
2. [6 med] `scripts/compile-rules.ts`, `rewriteLengthMatches`: the rewrite captures the first `matches` argument with a pattern that allows one level of nested parentheses. A future eSPap release with a deeper argument would be left as a regex and could reintroduce the minutes-long evaluation. The compiler now throws if any length regex survives, so the failure is loud rather than silent; keep that guard when updating the spec.
3. [6 low] `src/index.ts`, `validate`: `valid` ignores warnings. This matches eSPap's `IsValid`, which the oracle confirmed for the samples, but a caller gating a CI step on `valid` alone will never see warnings. The CLI prints them; the README should say that `valid` means "no fatal finding".
4. [1 low] The three `as unknown as Node` casts. A typed adapter between slimdom and fontoxpath would remove them; harmless today.
5. [5 info] Prior art: the Schematron packages on npm run on XPath 1.0 and cannot evaluate these rules; the engine header says so. `@attestwire/en16931` covers the EN 16931 base for other countries but has no Portuguese profile and no extension point, so it was not reused.

## One recommendation

A stress fixture set for finding 1 before publishing: a 500-line invoice with three-decimal prices and mixed VAT categories, run through both the engine and eSPap. It is the one place where the engine's result could differ from the platform's for a reason the tooling cannot show.

## What changed

New package for the demand test in `DEMAND-TEST.md`: a compiler that turns eSPap's Schematron files into a rule table, an engine with first-match-per-pattern semantics and `let` support, a public `validate` with a coverage block, a CLI with CI exit codes, the fifteen eSPap samples as fixtures, a two-language README, and a comparison tool against eSPap's public validator. Deliberately left undone: a builder, XSD validation, signatures, transmission. Remaining risk: decimal parity at scale, and specification drift when eSPap publishes a new version.

## Follow-up, 24 Oct 2026

Two defects found while building the stress fixtures, both fixed and both covered by tests.

1. **Rule contexts were evaluated as paths from the root, not as match patterns.** 66 of the 230 rules have a relative context such as `cac:InvoiceLine`; evaluated from the document node they matched nothing, so their 141 assertions never ran, and the coverage counter could not see it because a rule with no matching nodes contributes zero silently. The claim in the 23 Oct report that every assertion was evaluated was therefore wrong. Fix: the compiler now prefixes every top-level alternative of a context that does not start with a slash with `//`, which is the Schematron meaning. Evaluated counts rose on every sample (F.xml 2,197 to 2,460); all fifteen still pass, matching eSPap. New tests: BR-22, BR-26 and DT-CIUS-PT-157 fire on mutated lines.
2. **Two rules were quadratic in the number of lines**: the line-ID uniqueness check and the item-property counts recomputed document-wide expressions once per node. Fix: `ancestor::ubl:Invoice` is rewritten to `//ubl:Invoice` at compile time (a UBL document has one root of that name), and the engine evaluates context-independent expressions once per document. The independence check ignores string literals and predicate bodies, and a test evaluates every expression it classifies as independent from the root and from a deep node of a real sample and requires identical results. Measured after the fix: 500 lines in about 15 seconds and 2,000 lines in about 65 seconds, linear in line count; before it was 89 seconds for 500 and more than ten minutes for 2,000.

The decimal question from finding 1 is closed by reading the rules rather than by assumption: every arithmetic rule in this Schematron (DT-CIUS-PT-157, 160 to 167, 171 to 174) carries an acceptance range of 1.00, so a last-digit difference between JavaScript doubles and exact decimals cannot change a verdict. Generated invoices of 50, 500 and 2,000 lines with exact totals are valid for both the engine and eSPap's validator.

Counts after the follow-up: 37 tests, ESLint 0, tsc 0, build clean.

# cius-pt

Validate Portuguese public-sector e-invoices, CIUS-PT 2.1.1 in UBL 2.1, locally and in CI. No Java, no server, no account.

[Português abaixo.](#português)

```console
$ npx cius-pt invoice.xml
FAIL invoice.xml  Invoice  2 errors, 0 warnings
  ✗ DT-CIUS-PT-002  [DT-CIUS-PT-002]-The BT-2 does not meet the defined format: YYYY-MM-DD.
    at /Invoice[1]/cbc:IssueDate[1]
  ✗ DT-CIUS-PT-003_i  [DT-CIUS-PT-003]-The BT-3 only allows the following values: 380, 383, 386, 389, FT, FS, FR, ND, RP, RE, CS, LD
    at /Invoice[1]/cbc:InvoiceTypeCode[1]
1 document: 0 passed, 1 failed.
```

Exit code 1 when any document has a fatal finding, so it drops into a CI step as it is.

## What it checks

The rules are eSPap's own. The Schematron published with CIUS-PT 2.1.1 (26 February 2021) is compiled into a rule table and executed in-process by an XPath 3.1 engine. That is 1,155 assertions: the EN 16931 base rules plus 65 BR-CIUS-PT and 291 DT-CIUS-PT checks. Rule ids and messages in the output are eSPap's, so a finding here matches what the FE-AP platform would say.

Every result carries a `coverage` block. `assertionsEvaluated` is how many assertions ran against your document, and `unsupported` lists any the engine could not evaluate, with the engine's error. On eSPap's fifteen sample documents that list is empty.

Not checked, on purpose:

- XML Schema structure (the OASIS UBL 2.1 XSD). The Schematron catches most structural mistakes, but a document can be well-formed, pass here, and still be rejected for schema reasons.
- Digital signatures and certificates.
- Transmission to FE-AP.
- SAF-T, ATCUD and QR codes. Those belong to certified invoicing software, and this package stays outside that boundary.

## Library

```ts
import { validate } from 'cius-pt';

const result = validate(xmlString);
result.valid;            // no fatal findings
result.documentType;     // 'Invoice' | 'CreditNote' | null
result.customizationId;  // the cbc:CustomizationID text
result.errors;           // fatal findings: { id, flag, message, location, pattern }
result.warnings;         // warning findings
result.coverage;         // { assertionsInSpecification, assertionsEvaluated, unsupported, notChecked }
```

`location` is a position-based XPath to the element the rule fired on, in the document's own prefixes.

## CLI

```console
npx cius-pt invoice.xml credit-note.xml   # human-readable, exit 1 on failure
npx cius-pt --json invoice.xml            # the full result object per file
```

## Performance

Measured on a laptop with the engine warm: 0.25 seconds for eSPap's smallest sample, 0.7 seconds for the largest, about 15 seconds for a 500-line invoice and about 65 seconds for 2,000 lines, linear in the number of lines. Two things make that possible: one eSPap rule checks attachment length with a regular expression a JavaScript engine would take minutes on, so the compiler rewrites it into the equivalent string-length test; and expressions that cannot depend on the context node, such as the line-ID uniqueness check, are evaluated once per document instead of once per node.

## Status

Early. Validated against the fifteen sample documents eSPap publishes with the specification; all pass. Checked against eSPap's own public validator on 23 October 2026: the valid samples are valid there too, and a wrong invoice type code comes back with the same rule id, DT-CIUS-PT-003_i. One difference by design: eSPap runs the UBL XSD first, so a malformed date is a schema error there and DT-CIUS-PT-002 here. Generated invoices of 50, 500 and 2,000 lines with exact totals are valid for both. `scripts/compare-espap.ts` repeats that comparison for any document you may share, and `scripts/make-stress-fixtures.ts` builds the large ones. If your document is rejected by FE-AP and accepted here, or the other way round, please open an issue with the document, with the amounts and parties changed.

## Pro

A paid tier is planned if there is interest: a GitHub Action, a hosted validation endpoint, rule updates when eSPap publishes a new version, and email support, at 29 euros a month per organisation. If you would use it, say so by opening an issue titled "Pro". Nothing is charged today.

## Developing

```console
npm install
npm run compile-rules   # spec/cius-pt-2.1.1/schematron -> src/rules/cius-pt-2.1.1.ts
npm test
npm run build           # dist/ via tsup
npx tsx scripts/compare-espap.ts fixtures/espap-2.1.1/F_e.xml   # diff against eSPap's public validator
```

The Schematron files under `spec/` are eSPap's, reproduced unchanged. See `spec/cius-pt-2.1.1/NOTICE.md` and `fixtures/espap-2.1.1/NOTICE.md`.

---

## Português

Validação de faturas eletrónicas para a Administração Pública, CIUS-PT 2.1.1 em UBL 2.1, localmente e em integração contínua. Sem Java, sem servidor, sem conta.

```console
npx cius-pt fatura.xml
```

As regras são as da eSPap. O Schematron publicado com a especificação CIUS-PT 2.1.1 (26 de fevereiro de 2021) é compilado numa tabela de regras e executado em processo por um motor XPath 3.1: 1.155 asserções, as regras base da EN 16931 mais 65 BR-CIUS-PT e 291 DT-CIUS-PT. Os identificadores e mensagens no resultado são os da eSPap.

Cada resultado traz um bloco `coverage`: quantas asserções foram avaliadas e quais o motor não conseguiu avaliar, com o erro. Nos quinze documentos de exemplo da eSPap essa lista está vazia.

Não verifica, por opção: a estrutura XML Schema (XSD UBL 2.1), assinaturas digitais, a transmissão para a FE-AP, nem SAF-T, ATCUD e código QR, que pertencem ao software de faturação certificado.

Código de saída 1 quando há erros fatais. Para o objeto completo por ficheiro use `--json`.

Está numa fase inicial. Se um documento for rejeitado pela FE-AP e aceite aqui, ou o contrário, abra um issue com o documento, alterando montantes e entidades.

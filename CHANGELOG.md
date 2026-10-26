# Changelog

## 0.1.0 (2026-10-26)

First public release.

- `validate(xml)` checks a CIUS-PT 2.1.1 UBL invoice or credit note against eSPap's own Schematron: 1,155 assertions (the EN 16931 base rules plus 65 BR-CIUS-PT and 291 DT-CIUS-PT checks), compiled into a rule table and run in-process with an XPath 3.1 engine. No Java, no XSLT.
- Every finding carries eSPap's rule id, message and the XPath of the failing node. A `coverage` block lists any assertion the engine could not evaluate; for the fifteen eSPap samples that list is empty.
- CLI: `npx cius-pt invoice.xml`, exit code 1 when the document has errors.
- Checked against eSPap's public validator on 23 and 24 October 2026: same verdicts on the samples, the same rule id for a wrong invoice type code, and valid generated invoices of 50, 500 and 2,000 lines.
- Not included: the UBL XSD pass (eSPap runs it first, so a malformed date is a schema error there and DT-CIUS-PT-002 here), the CII syntax, signing, transmission to FE-AP.

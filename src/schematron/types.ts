/** A Schematron schema compiled into plain data, ready to evaluate with an XPath engine. */
export interface CompiledSchema {
  /** Identifier of the source, e.g. "CIUS-PT 2.1.1". */
  name: string;
  namespaces: Record<string, string>;
  patterns: CompiledPattern[];
}

export interface CompiledLet {
  name: string;
  value: string;
}

export interface CompiledPattern {
  id: string;
  lets: CompiledLet[];
  rules: CompiledRule[];
}

export interface CompiledRule {
  context: string;
  lets: CompiledLet[];
  assertions: CompiledAssertion[];
}

export interface CompiledAssertion {
  /** "assert" fires when the test is false; "report" fires when it is true. */
  kind: 'assert' | 'report';
  id: string;
  flag: 'fatal' | 'warning';
  test: string;
  message: string;
}

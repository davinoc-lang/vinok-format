/**
 * vinok/ast_nodes.ts
 * Noeuds de l'AST (Abstract Syntax Tree) pour le format VINOK.
 *
 * Chaque type de valeur est représenté par une classe dédiée,
 * ce qui permet un typage clair et un pattern visitor si besoin.
 */

// --- Type abstrait de base ---

export abstract class AstNode {
  public readonly line: number;
  public readonly column: number;

  constructor(line: number, column: number) {
    this.line = line;
    this.column = column;
  }

  /** Pour le debug : affichage lisible. */
  public abstract describe(indent?: number): string;
}

// --- Valeurs littérales ---

/** Valeur string, potentiellement avec interpolation ${...}. */
export class StringNode extends AstNode {
  /** Le texte brut (avec ${...} encore présent). */
  public readonly raw: string;

  constructor(raw: string, line: number, column: number) {
    super(line, column);
    this.raw = raw;
  }

  public describe(indent: number = 0): string {
    const pad = '  '.repeat(indent);
    return `${pad}String(${JSON.stringify(this.raw)})`;
  }
}

/** Valeur numérique (int ou float). */
export class NumberNode extends AstNode {
  public readonly value: string;

  constructor(value: string, line: number, column: number) {
    super(line, column);
    this.value = value;
  }

  public describe(indent: number = 0): string {
    const pad = '  '.repeat(indent);
    return `${pad}Number(${this.value})`;
  }
}

/** Valeur booléenne. */
export class BooleanNode extends AstNode {
  public readonly value: boolean;

  constructor(value: boolean, line: number, column: number) {
    super(line, column);
    this.value = value;
  }

  public describe(indent: number = 0): string {
    const pad = '  '.repeat(indent);
    return `${pad}Boolean(${this.value})`;
  }
}

/** Valeur null. */
export class NullNode extends AstNode {
  public describe(indent: number = 0): string {
    const pad = '  '.repeat(indent);
    return `${pad}Null`;
  }
}

// --- Conteneurs ---

/** Objet VINOK : liste de paires clé=valeur entre [ et ]. */
export class ObjectNode extends AstNode {
  public readonly entries: Map<string, AstNode> = new Map();

  constructor(line: number, column: number) {
    super(line, column);
  }

  public set(key: string, value: AstNode): void {
    this.entries.set(key, value);
  }

  public describe(indent: number = 0): string {
    const pad = '  '.repeat(indent);
    const lines = [`${pad}Object {`];
    for (const [key, node] of this.entries) {
      lines.push(`${pad}  ${key} = ${node.describe(indent + 2)}`);
    }
    lines.push(`${pad}}`);
    return lines.join('\n');
  }
}

/** Liste VINOK : [v1, v2, ...] ou liste d'objets [[...], [...]]. */
export class ListNode extends AstNode {
  public readonly items: AstNode[] = [];

  constructor(line: number, column: number) {
    super(line, column);
  }

  public push(item: AstNode): void {
    this.items.push(item);
  }

  public describe(indent: number = 0): string {
    const pad = '  '.repeat(indent);
    if (this.items.length === 0) return `${pad}List[]`;
    const lines = [`${pad}List [`];
    for (const item of this.items) {
      lines.push(`${pad}  ${item.describe(indent + 1)}`);
    }
    lines.push(`${pad}]`);
    return lines.join('\n');
  }
}

// --- Déclaration de haut niveau ---

/** Une paire clé = valeur au niveau racine. */
export class AssignmentNode extends AstNode {
  public readonly key: string;
  public readonly value: AstNode;

  constructor(key: string, value: AstNode, line: number, column: number) {
    super(line, column);
    this.key = key;
    this.value = value;
  }

  public describe(indent: number = 0): string {
    const pad = '  '.repeat(indent);
    return `${pad}${this.key} = ${this.value.describe(indent)}`;
  }
}

/** Le document complet : liste d'assignments. */
export class DocumentNode extends AstNode {
  public readonly assignments: AssignmentNode[] = [];

  constructor() {
    super(0, 0);
  }

  public push(assignment: AssignmentNode): void {
    this.assignments.push(assignment);
  }

  public describe(indent: number = 0): string {
    const pad = '  '.repeat(indent);
    const lines = [`${pad}Document {`];
    for (const a of this.assignments) {
      lines.push(a.describe(indent + 1));
    }
    lines.push(`${pad}}`);
    return lines.join('\n');
  }
}

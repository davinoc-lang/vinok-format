/**
 * vinok/symbols.ts
 * Table des symboles : résout les valeurs de l'AST en valeurs JS pures,
 * gère l'interpolation ${...} et détecte les références circulaires.
 *
 * Architecture :
 *   1. Enregistrer toutes les clés de haut niveau (phase de collecte).
 *   2. Résoudre chaque valeur en visitant l'AST (phase de résolution).
 *   3. Pour les strings, remplacer les ${...} par la valeur du symbole référencé.
 */

import {
  DocumentNode, AssignmentNode,
  StringNode, NumberNode, BooleanNode, NullNode,
  ObjectNode, ListNode, AstNode,
} from './ast_nodes.js';
import { UndefinedSymbolError, CircularReferenceError, SymbolRedefinedError, VinokParseError } from './exceptions.js';

export class SymbolTable {
  /** Valeurs résolues (clé -> valeur JS pure). */
  private symbols: Map<string, unknown> = new Map();

  /** AST brut pour les accès dot-notation. */
  private astMap: Map<string, AstNode> = new Map();

  // --- Phase 1 : collecte des clés ---

  /** Collecte les noms de clés et détecte les redéfinitions (E006). */
  public collect(doc: DocumentNode): void {
    for (const assignment of doc.assignments) {
      if (this.symbols.has(assignment.key)) {
        throw new SymbolRedefinedError(assignment.key, assignment.line, assignment.column);
      }
      // Marquer comme non résolu (sentinelle)
      this.symbols.set(assignment.key, undefined);
      this.astMap.set(assignment.key, assignment.value);
    }
  }

  // --- Phase 2 : résolution ---

  /** Résout toutes les valeurs, avec détection de circularité (E005). */
  public resolve(doc: DocumentNode): void {
    for (const assignment of doc.assignments) {
      this.resolveAssignment(assignment, []);
    }
  }

  /** Retourne la valeur résolue pour une clé. */
  public get(key: string): unknown {
    return this.symbols.get(key);
  }

  /** Toutes les entrées résolues. */
  public getAll(): Map<string, unknown> {
    return new Map(this.symbols);
  }

  // --- Résolution récursive ---

  private resolveAssignment(assignment: AssignmentNode, chain: string[]): void {
    if (chain.includes(assignment.key)) {
      throw new CircularReferenceError([...chain, assignment.key], assignment.line, assignment.column);
    }
    // Déjà résolu ?
    if (this.symbols.get(assignment.key) !== undefined || this.isResolvedNull(assignment.key)) {
      // Vérifier si c'est juste la sentinelle
      const astVal = this.astMap.get(assignment.key);
      if (astVal instanceof NullNode && this.symbols.get(assignment.key) === null) return;
      if (this.symbols.get(assignment.key) !== undefined) return;
      if (astVal instanceof NullNode) {
        this.symbols.set(assignment.key, null);
        return;
      }
    }
    const resolved = this.resolveNode(assignment.value, [...chain, assignment.key]);
    this.symbols.set(assignment.key, resolved);
  }

  private isResolvedNull(key: string): boolean {
    return this.symbols.get(key) === null;
  }

  private resolveNode(node: AstNode, chain: string[]): unknown {
    if (node instanceof StringNode) {
      return this.resolveString(node, chain);
    }
    if (node instanceof NumberNode) {
      return this.parseNumber(node.value);
    }
    if (node instanceof BooleanNode) {
      return node.value;
    }
    if (node instanceof NullNode) {
      return null;
    }
    if (node instanceof ObjectNode) {
      return this.resolveObject(node, chain);
    }
    if (node instanceof ListNode) {
      return this.resolveList(node, chain);
    }
    throw new VinokParseError('E002', `Unknown node type`, 'Unexpected AST node during resolution.', node.line, node.column);
  }

  private resolveString(node: StringNode, chain: string[]): string {
    // Remplacer toutes les occurrences de ${...}
    return node.raw.replace(/\$\{([^}]+)\}/g, (match: string, symbolPath: string, offset: number) => {
      const parts = symbolPath.trim().split('.');
      const rootKey = parts[0];

      // Calculer la colonne exacte du ${ dans la source
      const errorCol = node.column + offset;

      // S'assurer que le symbole racine est résolu
      if (!this.symbols.has(rootKey)) {
        throw new UndefinedSymbolError(rootKey, node.line, errorCol);
      }

      // Si c'est la sentinelle (pas encore résolu), le résoudre
      if (this.symbols.get(rootKey) === undefined) {
        const astNode = this.astMap.get(rootKey);
        if (astNode) {
          if (chain.includes(rootKey)) {
            throw new CircularReferenceError([...chain, rootKey], node.line, errorCol);
          }
          const resolved = this.resolveNode(astNode, [...chain, rootKey]);
          this.symbols.set(rootKey, resolved);
        }
      }

      const rootValue = this.symbols.get(rootKey);

      // Navigation dot-notation
      let current: unknown = rootValue;
      for (let i = 1; i < parts.length; i++) {
        if (current === null || current === undefined || typeof current !== 'object') {
          throw new UndefinedSymbolError(symbolPath, node.line, errorCol);
        }
        current = (current as Record<string, unknown>)[parts[i]];
      }

      if (current === undefined) {
        throw new UndefinedSymbolError(symbolPath, node.line, errorCol);
      }

      return String(current);
    });
  }

  private resolveObject(node: ObjectNode, chain: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, childNode] of node.entries) {
      result[key] = this.resolveNode(childNode, chain);
    }
    return result;
  }

  private resolveList(node: ListNode, chain: string[]): unknown[] {
    return node.items.map(item => this.resolveNode(item, chain));
  }

  private parseNumber(value: string): number {
    if (value.includes('.')) return parseFloat(value);
    return parseInt(value, 10);
  }
}

/**
 * vinok/config.ts
 * Classe principale VinokConfig — l'API OOP publique.
 *
 * Utilisation :
 *   const config = VinokConfig.parse(source);
 *   config.get('server.port')       // any
 *   config.getString('server.host')  // string
 *   config.getInt('port')            // number
 *   config.getBool('debug')          // boolean
 *   config.getFloat('ratio')         // number
 *   config.getList('tags')           // unknown[]
 */

import { Lexer, Token } from './lexer.js';
import { Parser } from './parser.js';
import { SymbolTable } from './symbols.js';
import { DocumentNode } from './ast_nodes.js';
import { VinokParseError } from './exceptions.js';

export class VinokConfig {
  private data: Map<string, unknown>;
  private doc: DocumentNode;
  private tokens: Token[];

  private constructor(data: Map<string, unknown>, doc: DocumentNode, tokens: Token[]) {
    this.data = data;
    this.doc = doc;
    this.tokens = tokens;
  }

  // --- Fabriques statiques ---

  /** Parse une string VINOK et retourne une VinokConfig. */
  public static parse(source: string): VinokConfig {
    const { data, doc, tokens } = compile(source);
    return new VinokConfig(data, doc, tokens);
  }

  /** Charge un fichier .vinok et retourne une VinokConfig. */
  public static async load(filePath: string): Promise<VinokConfig> {
    const source = await Bun.file(filePath).text();
    return VinokConfig.parse(source);
  }

  /** Charge un fichier .vinok de manière synchrone. */
  public static loadSync(filePath: string): VinokConfig {
    const source = require('fs').readFileSync(filePath, 'utf-8');
    return VinokConfig.parse(source);
  }

  // --- Accès aux valeurs ---

  /** Accès générique avec dot-notation. */
  public get(path: string): unknown {
    const parts = path.split('.');
    let current: unknown = this.data.get(parts[0]);

    if (current === undefined && parts.length === 1) {
      return undefined;
    }

    for (let i = 1; i < parts.length; i++) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[parts[i]];
    }

    return current;
  }

  /** Retourne la valeur comme string. */
  public getString(path: string, fallback?: string): string {
    const val = this.get(path);
    if (typeof val === 'string') return val;
    if (val === undefined && fallback !== undefined) return fallback;
    if (val === undefined) throw this.typeError(path, 'string');
    return String(val);
  }

  /** Retourne la valeur comme number entier. */
  public getInt(path: string, fallback?: number): number {
    const val = this.get(path);
    if (typeof val === 'number') return Math.trunc(val);
    if (typeof val === 'string') {
      const n = parseInt(val, 10);
      if (!isNaN(n)) return n;
    }
    if (val === undefined && fallback !== undefined) return fallback;
    if (val === undefined) throw this.typeError(path, 'int');
    throw this.typeError(path, 'int');
  }

  /** Retourne la valeur comme number (float). */
  public getFloat(path: string, fallback?: number): number {
    const val = this.get(path);
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const n = parseFloat(val);
      if (!isNaN(n)) return n;
    }
    if (val === undefined && fallback !== undefined) return fallback;
    if (val === undefined) throw this.typeError(path, 'float');
    throw this.typeError(path, 'float');
  }

  /** Retourne la valeur comme boolean. */
  public getBool(path: string, fallback?: boolean): boolean {
    const val = this.get(path);
    if (typeof val === 'boolean') return val;
    if (val === undefined && fallback !== undefined) return fallback;
    if (val === undefined) throw this.typeError(path, 'bool');
    throw this.typeError(path, 'bool');
  }

  /** Retourne la valeur comme liste. */
  public getList(path: string, fallback?: unknown[]): unknown[] {
    const val = this.get(path);
    if (Array.isArray(val)) return val;
    if (val === undefined && fallback !== undefined) return fallback;
    if (val === undefined) throw this.typeError(path, 'list');
    throw this.typeError(path, 'list');
  }

  /** Retourne la valeur comme objet (Record). */
  public getObject(path: string, fallback?: Record<string, unknown>): Record<string, unknown> {
    const val = this.get(path);
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
    if (val === undefined && fallback !== undefined) return fallback;
    if (val === undefined) throw this.typeError(path, 'object');
    throw this.typeError(path, 'object');
  }

  // --- Introspection ---

  /** Vérifie si une clé existe. */
  public has(path: string): boolean {
    return this.get(path) !== undefined;
  }

  /** Toutes les clés de premier niveau. */
  public keys(): string[] {
    return [...this.data.keys()];
  }

  /** Retourne un objet JS plat à partir des données. */
  public toObject(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.data) {
      result[key] = value;
    }
    return result;
  }

  /** Retourne l'AST pour le debug. */
  public getAst(): DocumentNode {
    return this.doc;
  }

  /** Retourne les tokens pour le debug. */
  public getTokens(): Token[] {
    return this.tokens;
  }

  // --- Privé ---

  private typeError(path: string, expected: string): Error {
    return new TypeError(`Cannot get '${path}' as ${expected}: got ${typeof this.get(path)}`);
  }
}

// --- Fonction de compilation interne ---

function compile(source: string): {
  data: Map<string, unknown>;
  doc: DocumentNode;
  tokens: Token[];
} {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const doc = parser.parse();

  const symbols = new SymbolTable();
  symbols.collect(doc);
  symbols.resolve(doc);

  return { data: symbols.getAll(), doc, tokens };
}
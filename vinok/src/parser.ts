/**
 * vinok/parser.ts
 * Analyseur syntaxique : transforme une liste de Token en AST (DocumentNode).
 *
 * Grammaire simplifiée :
 *   document     ::= (assignment)* EOF
 *   assignment   ::= key '=' value
 *   key          ::= Identifier | BacktickKey
 *   value        ::= String | Number | Boolean | Null | object | list
 *   object       ::= '[' (assignment ((',' | NL) assignment)*)? ']'
 *   list         ::= '[' (value ((',' | NL) value)*)? ']'
 *   NL = newline implicite (les newlines sont ignorés par le lexer → deux tokens
 *         consécutifs de type clé/valeur sans virgule entre eux = séparation par newline)
 */

import { Token, TokenType } from './lexer.js';
import {
  DocumentNode, AssignmentNode,
  StringNode, NumberNode, BooleanNode, NullNode,
  ObjectNode, ListNode,
} from './ast_nodes.js';
import { VinokParseError } from './exceptions.js';

export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /** Point d'entrée : parse le document complet. */
  public parse(): DocumentNode {
    const doc = new DocumentNode();

    while (!this.isEof()) {
      // """...""" au niveau document = commentaire docstring → skip
      if (this.current().type === TokenType.MultiLineString) {
        this.advance();
        continue;
      }
      doc.push(this.parseAssignment());
    }

    return doc;
  }

  // --- Règles de grammaire ---

  private parseAssignment(): AssignmentNode {
    const keyToken = this.expectKey();
    this.expect(TokenType.Assign);
    const value = this.parseValue();
    return new AssignmentNode(this.stripBackticks(keyToken.value), value, keyToken.line, keyToken.column);
  }

  private parseValue(): AstNode {
    const token = this.current();

    switch (token.type) {
      case TokenType.String:
      case TokenType.MultiLineString:
        this.advance();
        return new StringNode(token.value, token.line, token.column);

      case TokenType.Number:
        this.advance();
        return new NumberNode(token.value, token.line, token.column);

      case TokenType.Boolean:
        this.advance();
        return new BooleanNode(token.value === 'true', token.line, token.column);

      case TokenType.Null:
        this.advance();
        return new NullNode(token.line, token.column);

      case TokenType.LBrack:
        return this.parseBracketContent();

      default:
        throw new VinokParseError(
          'E011',
          `Unexpected token ${token.type}(${JSON.stringify(token.value)})`,
          `Expected a value (string, number, boolean, null, or '['), got ${token.type}.`,
          token.line,
          token.column,
        );
    }
  }

  /**
   * Détermine si [...] est un objet ou une liste.
   * Si le premier élément après [ est un Identifier/BacktickKey suivi de =,
   * c'est un objet. Sinon, c'est une liste.
   */
  private parseBracketContent(): ObjectNode | ListNode {
    const openBracket = this.current();
    this.advance(); // sauter [

    // [] vide -> liste vide
    if (this.current().type === TokenType.RBrack) {
      this.advance();
      const list = new ListNode(openBracket.line, openBracket.column);
      return list;
    }

    // Distinguer objet vs liste : regarder si on a key = value ou directement une valeur
    if (this.isKeyToken(this.current()) && this.peek().type === TokenType.Assign) {
      return this.parseObjectContent(openBracket);
    } else {
      return this.parseListContent(openBracket);
    }
  }

  private parseObjectContent(openToken: Token): ObjectNode {
    const obj = new ObjectNode(openToken.line, openToken.column);

    // Première paire
    obj.set(...this.parseKeyValue());

    // Paires suivantes — séparées par virgule OU par newline (implicite)
    while (true) {
      if (this.current().type === TokenType.Comma) {
        this.advance(); // sauter ,
        if (this.current().type === TokenType.RBrack) break; // trailing comma
        obj.set(...this.parseKeyValue());
      } else if (this.isKeyToken(this.current()) && this.peek().type === TokenType.Assign) {
        // Pas de virgule → séparation par newline implicite
        obj.set(...this.parseKeyValue());
      } else {
        break;
      }
    }

    this.expect(TokenType.RBrack);
    return obj;
  }

  private parseListContent(openToken: Token): ListNode {
    const list = new ListNode(openToken.line, openToken.column);

    // Premier élément
    list.push(this.parseValue());

    // Éléments suivants — séparés par virgule OU par newline (implicite)
    while (true) {
      if (this.current().type === TokenType.Comma) {
        this.advance(); // sauter ,
        if (this.current().type === TokenType.RBrack) break; // trailing comma
        list.push(this.parseValue());
      } else if (this.isValueStartToken(this.current())) {
        // Pas de virgule → séparation par newline implicite
        list.push(this.parseValue());
      } else {
        break;
      }
    }

    this.expect(TokenType.RBrack);
    return list;
  }

  private parseKeyValue(): [string, AstNode] {
    const keyToken = this.expectKey();
    this.expect(TokenType.Assign);
    const value = this.parseValue();
    return [this.stripBackticks(keyToken.value), value];
  }

  // --- Utilitaires de navigation ---

  private current(): Token {
    return this.tokens[this.pos]!;
  }

  private peek(): Token {
    return this.tokens[this.pos + 1] ?? this.tokens[this.pos]!;
  }

  private advance(): void {
    if (this.pos < this.tokens.length - 1) this.pos++;
  }

  private isEof(): boolean {
    return this.current().type === TokenType.Eof;
  }

  private isKeyToken(token: Token): boolean {
    return token.type === TokenType.Identifier || token.type === TokenType.BacktickKey;
  }

  /** Retire les backticks délimiteurs d'une clé (BacktickKey). Les identificateurs sont retournés tels quels. */
  private stripBackticks(key: string): string {
    if (key.startsWith('`') && key.endsWith('`')) {
      return key.slice(1, -1);
    }
    return key;
  }

  /** Vérifie si le token peut démarrer une valeur (pour la séparation par newline dans les listes). */
  private isValueStartToken(token: Token): boolean {
    return (
      token.type === TokenType.String ||
      token.type === TokenType.MultiLineString ||
      token.type === TokenType.Number ||
      token.type === TokenType.Boolean ||
      token.type === TokenType.Null ||
      token.type === TokenType.LBrack
    );
  }

  private expectKey(): Token {
    const token = this.current();
    if (!this.isKeyToken(token)) {
      throw new VinokParseError(
        'E011',
        `Expected key (Identifier or BacktickKey), got ${token.type}(${JSON.stringify(token.value)})`,
        'A definition must start with a key name. Keys can be identifiers (letters, digits, hyphens, underscores) or backtick-enclosed strings for special characters.',
        token.line,
        token.column,
      );
    }
    this.advance();
    return token;
  }

  private expect(type: TokenType): void {
    const token = this.current();
    if (token.type !== type) {
      throw new VinokParseError(
        'E011',
        `Expected ${type}, got ${token.type}(${JSON.stringify(token.value)})`,
        `Expected '${type}' here. Check for missing characters or extra tokens.`,
        token.line,
        token.column,
      );
    }
    this.advance();
  }
}

// Import nécessaire pour le type de retour
import type { AstNode } from './ast_nodes.js';

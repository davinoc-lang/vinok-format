/**
 * vinok/lexer.ts
 * Analyseur lexical (tokenizer) pour le format VINOK.
 *
 * Produit une liste de Token à partir du texte source.
 * Gère : strings ("..." et `...`), multiline strings ("""..."""),
 *         nombres, booléens, null, identificateurs, opérateurs,
 *         commentaires (# et //), interpolation ${...}, backtick keys.
 */

import { UnterminatedStringError, InvalidEscapeError, UnterminatedInterpolationError, InvalidCharacterError } from './exceptions.js';

// --- Types de tokens ---

export enum TokenType {
  // Littéraux
  String        = 'String',
  MultiLineString = 'MultiLineString', // """...""" — commentaire docstring ou valeur
  Number        = 'Number',
  Boolean       = 'Boolean',
  Null          = 'Null',

  // Identifiants et clés
  Identifier    = 'Identifier',
  BacktickKey   = 'BacktickKey',

  // Opérateurs et ponctuation
  Assign        = 'Assign',       // =
  Equals        = 'Equals',       // == (futur)
  LBrack        = 'LBrack',       // [
  RBrack        = 'RBrack',       // ]
  LBrace        = 'LBrace',       // ${
  RBrace        = 'RBrace',       // }
  Comma         = 'Comma',        // ,
  Dot           = 'Dot',          // .
  Interpolation = 'Interpolation', // ${...} déjà résolu en string

  // Spécial
  Eof           = 'Eof',
}

export class Token {
  constructor(
    public readonly type: TokenType,
    public readonly value: string,
    public readonly line: number,
    public readonly column: number,
  ) {}

  public toString(): string {
    return `${this.type}(${JSON.stringify(this.value)}) @ ${this.line}:${this.column}`;
  }
}

// --- Lexer ---

export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 0;

  constructor(source: string) {
    this.source = source;
  }

  /** Tokenise l'intégralité de la source et retourne la liste des tokens. */
  public tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.pos < this.source.length) {
      this.skipWhitespaceAndNewlines();

      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];

      // Commentaires
      if (ch === '#' || (ch === '/' && this.peekNext() === '/')) {
        this.skipComment();
        continue;
      }

      // Référence nue ${...} (en dehors d'un string)
      if (ch === '$' && this.peekNext() === '{') {
        const raw = this.readRawInterpolation();
        tokens.push(new Token(TokenType.String, raw, this.line, this.column - raw.length + 1));
        continue;
      }

      // String double quote
      if (ch === '"') {
        tokens.push(this.readString());
        continue;
      }

      // Backtick (backtick key ou string backtick)
      if (ch === '`') {
        tokens.push(this.readBacktickKey());
        continue;
      }

      // Ponctuation
      if (ch === '=') {
        if (this.peekNext() === '=') {
          this.advance(); this.advance();
          tokens.push(new Token(TokenType.Equals, '==', this.line, this.column));
        } else {
          this.advance();
          tokens.push(new Token(TokenType.Assign, '=', this.line, this.column));
        }
        continue;
      }

      if (ch === '[') { this.advance(); tokens.push(new Token(TokenType.LBrack, '[', this.line, this.column)); continue; }
      if (ch === ']') { this.advance(); tokens.push(new Token(TokenType.RBrack, ']', this.line, this.column)); continue; }
      if (ch === ',') { this.advance(); tokens.push(new Token(TokenType.Comma, ',', this.line, this.column)); continue; }
      if (ch === '.') { this.advance(); tokens.push(new Token(TokenType.Dot, '.', this.line, this.column)); continue; }

      // String single quote
      if (ch === "'") {
        tokens.push(this.readSingleQuoteString());
        continue;
      }

      // Nombre (commence par digit ou moins suivi d'un digit)
      if (this.isDigit(ch) || (ch === '-' && this.pos + 1 < this.source.length && this.isDigit(this.source[this.pos + 1]))) {
        tokens.push(this.readNumber());
        continue;
      }

      // Identificateur / mot-clé (true, false, null, ou clé normale)
      if (this.isIdentStart(ch)) {
        tokens.push(this.readIdentifier());
        continue;
      }

      throw new InvalidCharacterError(ch, this.line, this.column);
    }

    tokens.push(new Token(TokenType.Eof, '', this.line, this.column));
    return tokens;
  }

  // --- Lecture des tokens ---

  private readString(): Token {
    const startLine = this.line;
    const startCol = this.column;

    // Vérifier multiline """
    if (
      this.pos + 2 < this.source.length &&
      this.source[this.pos + 1] === '"' &&
      this.source[this.pos + 2] === '"'
    ) {
      return this.readMultilineString(startLine, startCol);
    }

    this.advance(); // ouvrir "
    let value = '';

    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      if (this.source[this.pos] === '\\') {
        value += this.readEscape();
      } else if (this.source[this.pos] === '$' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '{') {
        // On inclut l'interpolation dans le token string tel quel.
        // Le parser s'occupera de résoudre ${...}.
        value += this.readRawInterpolation();
      } else if (this.source[this.pos] === '\n') {
        this.advanceLine();
        value += '\n';
      } else {
        value += this.source[this.pos];
        this.advance();
      }
    }

    if (this.pos >= this.source.length) {
      throw new UnterminatedStringError(startLine, startCol);
    }

    this.advance(); // fermer "
    return new Token(TokenType.String, value, startLine, startCol);
  }

  private readMultilineString(startLine: number, startCol: number): Token {
    this.advance(); this.advance(); this.advance(); // """
    let value = '';

    while (this.pos < this.source.length) {
      // Vérifier """ — besoin de 3 chars donc pos+2 <= length-1
      if (
        this.source[this.pos] === '"' &&
        this.pos + 2 <= this.source.length - 1 &&
        this.source[this.pos + 1] === '"' &&
        this.source[this.pos + 2] === '"'
      ) {
        this.advance(); this.advance(); this.advance();
        // Retirer le saut de ligne initial et final si présents
        if (value.startsWith('\n')) value = value.substring(1);
        if (value.endsWith('\n')) value = value.substring(0, value.length - 1);
        return new Token(TokenType.MultiLineString, value, startLine, startCol);
      }

      if (this.source[this.pos] === '\\') {
        value += this.readEscape();
      } else if (this.source[this.pos] === '$' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '{') {
        value += this.readRawInterpolation();
      } else if (this.source[this.pos] === '\n') {
        this.advanceLine();
        value += '\n';
      } else {
        value += this.source[this.pos];
        this.advance();
      }
    }

    throw new UnterminatedStringError(startLine, startCol);
  }

  private readSingleQuoteString(): Token {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // ouvrir '
    let value = '';

    while (this.pos < this.source.length && this.source[this.pos] !== "'") {
      if (this.source[this.pos] === '\n') {
        this.advanceLine();
        value += '\n';
      } else {
        value += this.source[this.pos];
        this.advance();
      }
    }

    if (this.pos >= this.source.length) {
      throw new UnterminatedStringError(startLine, startCol);
    }

    this.advance(); // fermer '
    return new Token(TokenType.String, value, startLine, startCol);
  }

  private readBacktickKey(): Token {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // ouvrir `
    let value = '`';

    while (this.pos < this.source.length && this.source[this.pos] !== '`') {
      if (this.source[this.pos] === '\\' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '`') {
        value += '`';
        this.advance(); this.advance();
      } else {
        value += this.source[this.pos];
        this.advance();
      }
    }

    if (this.pos >= this.source.length) {
      throw new UnterminatedStringError(startLine, startCol);
    }

    this.advance(); // fermer `
    value += '`';
    return new Token(TokenType.BacktickKey, value, startLine, startCol);
  }

  private readNumber(): Token {
    const startLine = this.line;
    const startCol = this.column;
    let value = '';

    if (this.source[this.pos] === '-') { value += '-'; this.advance(); }

    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      value += this.source[this.pos];
      this.advance();
    }

    // Partie décimale
    if (this.pos < this.source.length && this.source[this.pos] === '.') {
      // Vérifier que ce n'est pas un point isolé (pas suivi d'un digit -> c'est pas un nombre)
      if (this.pos + 1 < this.source.length && this.isDigit(this.source[this.pos + 1])) {
        value += '.'; this.advance();
        while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
          value += this.source[this.pos];
          this.advance();
        }
      }
    }

    return new Token(TokenType.Number, value, startLine, startCol);
  }

  private readIdentifier(): Token {
    const startLine = this.line;
    const startCol = this.column;
    let value = '';

    while (this.pos < this.source.length && this.isIdentPart(this.source[this.pos])) {
      value += this.source[this.pos];
      this.advance();
    }

    // Mots-clés
    if (value === 'true' || value === 'false') {
      return new Token(TokenType.Boolean, value, startLine, startCol);
    }
    if (value === 'null') {
      return new Token(TokenType.Null, value, startLine, startCol);
    }

    return new Token(TokenType.Identifier, value, startLine, startCol);
  }

  private readEscape(): string {
    this.advance(); // sauter le backslash
    if (this.pos >= this.source.length) {
      throw new InvalidEscapeError('EOF', this.line, this.column);
    }
    const ch = this.source[this.pos];
    this.advance();
    switch (ch) {
      case 'n':  return '\n';
      case 't':  return '\t';
      case 'r':  return '\r';
      case '\\': return '\\';
      case '"':  return '"';
      case "'":  return "'";
      case '$':  return '$';
      default:   throw new InvalidEscapeError(ch, this.line, this.column);
    }
  }

  /** Lit ${...} brut et retourne le texte tel quel (avec ${ et }). */
  private readRawInterpolation(): string {
    const startLine = this.line;
    const startCol = this.column;
    let raw = '';
    raw += this.source[this.pos]; this.advance(); // $
    raw += this.source[this.pos]; this.advance(); // {

    let depth = 1;
    while (this.pos < this.source.length && depth > 0) {
      if (this.source[this.pos] === '{') depth++;
      if (this.source[this.pos] === '}') {
        depth--;
        if (depth === 0) { raw += '}'; this.advance(); break; }
      }
      if (this.source[this.pos] === '\n') this.advanceLine();
      raw += this.source[this.pos];
      this.advance();
    }

    if (depth > 0) {
      throw new UnterminatedInterpolationError(startLine, startCol);
    }

    return raw;
  }

  // --- Utilitaires ---

  private skipWhitespaceAndNewlines(): void {
    while (this.pos < this.source.length) {
      if (this.source[this.pos] === ' ' || this.source[this.pos] === '\t') {
        this.advance();
      } else if (this.source[this.pos] === '\r') {
        this.advanceLine();
      } else if (this.source[this.pos] === '\n') {
        this.advanceLine();
      } else {
        break;
      }
    }
  }

  private skipComment(): void {
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.advance();
    }
  }

  private advance(): void {
    this.pos++;
    this.column++;
  }

  private advanceLine(): void {
    this.pos++;
    this.line++;
    this.column = 0;
  }

  private peekNext(): string {
    return this.pos + 1 < this.source.length ? this.source[this.pos + 1] : '';
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch) || ch === '-';
  }
}

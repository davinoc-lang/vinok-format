/**
 * vinok/exceptions.ts
 * Exceptions personnalisées pour le parser VINOK.
 * Codes d'erreur E001 à E011 conformes à la spec.
 *
 * Chaque erreur contient :
 *   - code       : identifiant unique (E001, E002, ...)
 *   - message    : description courte de l'erreur
 *   - hint       : suggestion pour corriger (une phrase)
 *   - line/col   : position dans la source
 *   - sourceLine : contenu de la ligne en erreur (injecté par formatError)
 *
 * Usage CLI : VinokError.format(err, source, filePath) -> string joli
 */

export class VinokError extends Error {
  public readonly code: string;
  public readonly line: number;
  public readonly column: number;
  public readonly hint: string;

  constructor(code: string, message: string, hint: string, line: number = 0, column: number = 0) {
    super(message);
    this.name = 'VinokError';
    this.code = code;
    this.line = line;
    this.column = column;
    this.hint = hint;
  }

  // --- Pretty-printing ---

  /**
   * Formate l'erreur pour l'affichage terminal.
   * Produit un rendu style Rust/clang avec la ligne source et un curseur.
   *
   * Exemple :
   *   error[E001]: Undefined symbol 'app-nam'
   *     --> examples/full.vinok:77:18
   *      |
   *   77 | msg = "Hello ${app-nam}!"
   *      |                  ^^^^^^^^ 
   *      |
   *      = hint: Did you mean 'app-name'? Check that all referenced symbols are defined before use.
   */
  static format(err: VinokError, source?: string, filePath?: string): string {
    const lines: string[] = [];

    // Header
    lines.push(`error[${err.code}]: ${err.message}`);

    // Location
    const loc = err.line > 0
      ? `${filePath ?? '<input>'}:${err.line}:${err.column}`
      : filePath ?? '<input>';
    lines.push(`  --> ${loc}`);

    // Source context avec curseur
    if (source && err.line > 0) {
      const srcLines = source.split('\n');
      const lineIdx = err.line - 1;
      const lineContent = lineIdx < srcLines.length ? srcLines[lineIdx] : undefined;

      if (lineContent !== undefined) {
        const lineNum = String(err.line).padStart(String(err.line).length, ' ');
        const gutter = ' '.repeat(String(err.line).length);

        lines.push('  |');
        lines.push(`${lineNum} | ${lineContent}`);

        // Curseur
        if (err.column > 0) {
          const padding = ' '.repeat((err.column - 1) + gutter.length + 3);
          // Longueur du curseur : on souligne le token (jusqu'au prochain espace ou fin de mot)
          const restOfLine = lineContent.slice(err.column - 1);
          const tokenLen = Math.max(1, restOfLine.search(/\s|$/) ?? restOfLine.length);
          lines.push(`${padding}^${'~'.repeat(Math.max(0, tokenLen - 1))}`);
        }
        lines.push('  |');
      }
    }

    // Hint
    if (err.hint) {
      lines.push(`  = hint: ${err.hint}`);
    }

    return lines.join('\n');
  }
}

export class VinokParseError extends VinokError {
  constructor(code: string, message: string, hint: string, line: number = 0, column: number = 0) {
    super(code, message, hint, line, column);
    this.name = 'VinokParseError';
  }
}

// --- Codes d'erreur documentés ---

/** E001 - Symbole non défini */
export class UndefinedSymbolError extends VinokParseError {
  constructor(symbol: string, line: number = 0, col: number = 0) {
    super(
      'E001',
      `Undefined symbol '${symbol}'`,
      `The symbol '${symbol}' is not defined. Make sure it is declared before being referenced in an interpolation.`,
      line,
      col,
    );
  }
}

/** E002 - Valeur littérale hors définition */
export class LiteralOutsideDefinitionError extends VinokParseError {
  constructor(value: string, line: number = 0, col: number = 0) {
    super(
      'E002',
      `Literal value '${value}' outside of definition`,
      `A literal value was found outside a key = value definition. Each value must be assigned to a key.`,
      line,
      col,
    );
  }
}

/** E003 - Indexation interdite */
export class ForbiddenIndexingError extends VinokParseError {
  constructor(key: string, line: number = 0, col: number = 0) {
    super(
      'E003',
      `Forbidden indexing on '${key}'`,
      `VINOK does not support array indexing. Use dot-notation to access object fields instead.`,
      line,
      col,
    );
  }
}

/** E005 - Référence circulaire */
export class CircularReferenceError extends VinokParseError {
  constructor(path: string[], line: number = 0, col: number = 0) {
    super(
      'E005',
      `Circular reference detected: ${path.join(' -> ')}`,
      `Remove the circular dependency. Symbol '${path[0]}' and '${path[path.length - 1]}' reference each other directly or indirectly.`,
      line,
      col,
    );
  }
}

/** E006 - Redéfinition de symbole */
export class SymbolRedefinedError extends VinokParseError {
  constructor(symbol: string, line: number = 0, col: number = 0) {
    super(
      'E006',
      `Symbol '${symbol}' is already defined`,
      `Each symbol can only be defined once. Rename or remove the duplicate definition of '${symbol}'.`,
      line,
      col,
    );
  }
}

/** E008 - String non terminée */
export class UnterminatedStringError extends VinokParseError {
  constructor(line: number = 0, col: number = 0) {
    super(
      'E008',
      'Unterminated string',
      `A string literal is missing its closing quote (" or '). Add the matching quote at the end of the string.`,
      line,
      col,
    );
  }
}

/** E009 - Séquence d'échappement invalide */
export class InvalidEscapeError extends VinokParseError {
  constructor(seq: string, line: number = 0, col: number = 0) {
    super(
      'E009',
      `Invalid escape sequence '\\${seq}'`,
      `The sequence '\\${seq}' is not a valid escape. Use one of: \\n, \\t, \\r, \\\\, \\", \\', \\\$.`,
      line,
      col,
    );
  }
}

/** E010 - Interpolation non terminée */
export class UnterminatedInterpolationError extends VinokParseError {
  constructor(line: number = 0, col: number = 0) {
    super(
      'E010',
      'Unterminated interpolation ${...}',
      `An interpolation block is missing its closing '}'. Add '}' to close the interpolation.`,
      line,
      col,
    );
  }
}

/** E011 - Caractère invalide */
export class InvalidCharacterError extends VinokParseError {
  constructor(char: string, line: number = 0, col: number = 0) {
    const display = char === ' ' ? '<space>' : char === '\n' ? '<newline>' : char === '\t' ? '<tab>' : char;
    super(
      'E011',
      `Invalid character '${display}'`,
      `The character '${display}' is not allowed in VINOK. Remove it or check for a typo.`,
      line,
      col,
    );
  }
}

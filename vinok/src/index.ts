/**
 * vinok/index.ts
 * Point d'entrée principal — réexporte l'API publique.
 *
 * Utilisation :
 *   import { VinokConfig, parse, load, validate } from 'vinok';
 *   import { to_json, to_flat_json, dump_json } from 'vinok/utils';
 */

// Classe principale
export { VinokConfig } from './config.js';

// Fonctions rapides
import { VinokConfig } from './config.js';

/** Parse une string VINOK et retourne une VinokConfig. */
export function parse(source: string): VinokConfig {
  return VinokConfig.parse(source);
}

/** Charge un fichier .vinok. */
export async function load(filePath: string): Promise<VinokConfig> {
  return VinokConfig.load(filePath);
}

// Validation
export { validate } from './validate.js';

// Exceptions
export {
  VinokError, VinokParseError,
  UndefinedSymbolError, LiteralOutsideDefinitionError,
  ForbiddenIndexingError, CircularReferenceError,
  SymbolRedefinedError, UnterminatedStringError,
  InvalidEscapeError, UnterminatedInterpolationError,
  InvalidCharacterError,
} from './exceptions.js';

// Lexer (pour le debug)
export { Lexer, Token, TokenType } from './lexer.js';

// AST (pour le debug / extensions)
export {
  AstNode, DocumentNode, AssignmentNode,
  StringNode, NumberNode, BooleanNode, NullNode,
  ObjectNode, ListNode,
} from './ast_nodes.js';

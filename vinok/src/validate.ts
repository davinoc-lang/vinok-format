/**
 * vinok/validate.ts
 * Validation d'une source VINOK sans produire de config.
 * Retourne [true] si OK, ou [false, erreur] si problème.
 */

import { VinokParseError } from './exceptions.js';
import { VinokConfig } from './config.js';

export function validate(source: string): [boolean, string?] {
  try {
    VinokConfig.parse(source);
    return [true];
  } catch (e) {
    if (e instanceof VinokParseError) {
      return [false, `[${e.code}] ${e.message}
  = hint: ${e.hint}`];
    }
    if (e instanceof Error) {
      return [false, e.message];
    }
    return [false, String(e)];
  }
}

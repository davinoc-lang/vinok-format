/**
 * vinok/utils.ts
 * Fonctions utilitaires : export JSON, flat JSON (Spring),
 * dump fichier, merge, diff, lister les clés.
 */

import { VinokConfig } from './config.js';
import type { DocumentNode } from './ast_nodes.js';

// --- JSON exports ---

/** Convertit une config en JSON standard. */
export function to_json(config: VinokConfig, indent: number = 2): string {
  return JSON.stringify(config.toObject(), null, indent);
}

/** Convertit une config en JSON aplati (style Spring Boot). */
export function to_flat_json(config: VinokConfig, separator: string = '.'): string {
  const flat = flattenObject(config.toObject(), separator);
  return JSON.stringify(flat, null, 2);
}

/** Sauvegarde la config en JSON dans un fichier. */
export async function dump_json(config: VinokConfig, filePath: string, format: 'json' | 'flat-json' | 'env' = 'json', indent: number = 2): Promise<void> {
  let content: string;

  switch (format) {
    case 'flat-json':
      content = to_flat_json(config);
      break;
    case 'env':
      content = to_env(config);
      break;
    default:
      content = to_json(config, indent);
  }

  await Bun.write(filePath, content);
}

/** Convertit en variables d'environnement. */
export function to_env(config: VinokConfig, prefix: string = ''): string {
  const flat = flattenObject(config.toObject(), '_');
  const lines: string[] = [];

  for (const [key, value] of Object.entries(flat)) {
    const envKey = (prefix + key).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const envVal = typeof value === 'string' ? value : JSON.stringify(value);
    lines.push(`${envKey}=${envVal}`);
  }

  return lines.join('\n');
}

// --- Merge ---

/** Fusionne deux configs. Les clés de `override` écrasent celles de `base`. */
export function merge_configs(base: VinokConfig, override: VinokConfig): Record<string, unknown> {
  return deepMerge(base.toObject(), override.toObject());
}

// --- Diff ---

/** Compare deux configs et retourne les différences. */
export function diff_configs(a: VinokConfig, b: VinokConfig): {
  onlyInA: string[];
  onlyInB: string[];
  different: string[];
} {
  const keysA = new Set(get_all_keys_flat(a.toObject()));
  const keysB = new Set(get_all_keys_flat(b.toObject()));

  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  const different: string[] = [];

  for (const key of keysA) {
    if (!keysB.has(key)) {
      onlyInA.push(key);
    } else {
      const valA = resolvePath(a.toObject(), key);
      const valB = resolvePath(b.toObject(), key);
      if (JSON.stringify(valA) !== JSON.stringify(valB)) {
        different.push(key);
      }
    }
  }

  for (const key of keysB) {
    if (!keysA.has(key)) {
      onlyInB.push(key);
    }
  }

  return { onlyInA, onlyInB, different };
}

// --- Keys listing ---

/** Liste toutes les clés plates (dot-notation). */
export function get_all_keys(config: VinokConfig, separator: string = '.'): string[] {
  return get_all_keys_flat(config.toObject(), separator);
}

// --- Internes ---

function flattenObject(obj: Record<string, unknown>, separator: string, prefix: string = ''): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}${separator}${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, separator, fullKey));
    } else {
      result[fullKey] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }

  return result;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function get_all_keys_flat(obj: Record<string, unknown>, separator: string = '.', prefix: string = ''): string[] {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}${separator}${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...get_all_keys_flat(value as Record<string, unknown>, separator, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

function resolvePath(obj: Record<string, unknown>, path: string, separator: string = '.'): unknown {
  const parts = path.split(separator);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

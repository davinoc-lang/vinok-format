/**
 * vinok/tests/vinok.test.ts
 * Suite de tests complète pour le parser VINOK.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { VinokConfig, parse, validate } from '../src/index.js';
import { to_json, to_flat_json, to_env, get_all_keys, diff_configs, merge_configs } from '../src/utils.js';
import { Lexer, TokenType } from '../src/lexer.js';
import {
  UndefinedSymbolError, CircularReferenceError, SymbolRedefinedError,
  UnterminatedStringError, InvalidEscapeError, UnterminatedInterpolationError,
  InvalidCharacterError,
} from '../src/exceptions.js';

// =================================================================
// 1. LEXER
// =================================================================

describe('Lexer', () => {
  it('tokenise un string double quote', () => {
    const lex = new Lexer('name = "hello"');
    const tokens = lex.tokenize();
    expect(tokens[0].type).toBe(TokenType.Identifier);
    expect(tokens[0].value).toBe('name');
    expect(tokens[1].type).toBe(TokenType.Assign);
    expect(tokens[2].type).toBe(TokenType.String);
    expect(tokens[2].value).toBe('hello');
    expect(tokens[3].type).toBe(TokenType.Eof);
  });

  it('tokenise un string single quote', () => {
    const lex = new Lexer("name = 'world'");
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.String);
    expect(tokens[2].value).toBe('world');
  });

  it('tokenise un multiline string', () => {
    const src = 'desc = """\nhello\nworld\n"""';
    const lex = new Lexer(src);
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.MultiLineString);
    expect(tokens[2].value).toBe('hello\nworld');
  });

  it('tokenise un nombre entier', () => {
    const lex = new Lexer('port = 8080');
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.Number);
    expect(tokens[2].value).toBe('8080');
  });

  it('tokenise un nombre flottant', () => {
    const lex = new Lexer('ratio = 3.14159');
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.Number);
    expect(tokens[2].value).toBe('3.14159');
  });

  it('tokenise un nombre négatif', () => {
    const lex = new Lexer('val = -42');
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.Number);
    expect(tokens[2].value).toBe('-42');
  });

  it('tokenise les booléens', () => {
    const lex = new Lexer('a = true\nb = false');
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.Boolean);
    expect(tokens[2].value).toBe('true');
    expect(tokens[5].type).toBe(TokenType.Boolean);
    expect(tokens[5].value).toBe('false');
  });

  it('tokenise null', () => {
    const lex = new Lexer('opt = null');
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.Null);
    expect(tokens[2].value).toBe('null');
  });

  it('tokenise les identifiants avec tirets', () => {
    const lex = new Lexer('app-name = "test"');
    const tokens = lex.tokenize();
    expect(tokens[0].type).toBe(TokenType.Identifier);
    expect(tokens[0].value).toBe('app-name');
  });

  it('tokenise les backtick keys', () => {
    const lex = new Lexer('`pool size` = 10');
    const tokens = lex.tokenize();
    expect(tokens[0].type).toBe(TokenType.BacktickKey);
    expect(tokens[0].value).toBe('`pool size`');
  });

  it('tokenise un backtick key avec backtick échappé', () => {
    const lex = new Lexer('`key-with-\\`backticks\\`` = "value4"');
    const tokens = lex.tokenize();
    expect(tokens[0].type).toBe(TokenType.BacktickKey);
    expect(tokens[0].value).toBe('`key-with-\`backticks\``');
  });

  it('ignore les commentaires # et //', () => {
    const lex = new Lexer('a = 1 # comment\nb = 2 // another');
    const tokens = lex.tokenize();
    // a = 1 EOF
    expect(tokens[0].value).toBe('a');
    expect(tokens[1].type).toBe(TokenType.Assign);
    expect(tokens[2].value).toBe('1');
    expect(tokens[3].value).toBe('b');
    expect(tokens[4].type).toBe(TokenType.Assign);
    expect(tokens[5].value).toBe('2');
  });

  it('tokenise une liste simple', () => {
    const lex = new Lexer('tags = ["web", "api", "production"]');
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.LBrack);
    expect(tokens[3].value).toBe('web');
    expect(tokens[5].value).toBe('api');
    expect(tokens[7].value).toBe('production');
    expect(tokens[8].type).toBe(TokenType.RBrack);
  });

  it('gère les séquences d\'échappement dans les strings', () => {
    const lex = new Lexer(String.raw`s = "hello\nworld\t!"`);
    const tokens = lex.tokenize();
    expect(tokens[2].type).toBe(TokenType.String);
    expect(tokens[2].value).toBe('hello\nworld\t!');
  });

  it('erreur E008 : string non terminée', () => {
    const lex = new Lexer('s = "hello');
    expect(() => lex.tokenize()).toThrow(UnterminatedStringError);
  });

  it('erreur E009 : séquence d\'échappement invalide', () => {
    const lex = new Lexer('s = "hello\\x"');
    expect(() => lex.tokenize()).toThrow(InvalidEscapeError);
  });

  it('erreur E011 : caractère invalide', () => {
    const lex = new Lexer('@');
    expect(() => lex.tokenize()).toThrow(InvalidCharacterError);
  });
});

// =================================================================
// 2. PARSER + CONFIG (base)
// =================================================================

describe('Parser + Config : types de base', () => {
  it('parse un string', () => {
    const c = parse('name = "MyApp"');
    expect(c.getString('name')).toBe('MyApp');
  });

  it('parse un nombre entier', () => {
    const c = parse('port = 8080');
    expect(c.getInt('port')).toBe(8080);
  });

  it('parse un flottant', () => {
    const c = parse('ratio = 3.14159');
    expect(c.getFloat('ratio')).toBeCloseTo(3.14159);
  });

  it('parse un booléen true', () => {
    const c = parse('debug = true');
    expect(c.getBool('debug')).toBe(true);
  });

  it('parse un booléen false', () => {
    const c = parse('ssl = false');
    expect(c.getBool('ssl')).toBe(false);
  });

  it('parse null', () => {
    const c = parse('opt = null');
    expect(c.get('opt')).toBeNull();
  });

  it('parse un nombre négatif', () => {
    const c = parse('val = -42');
    expect(c.getInt('val')).toBe(-42);
  });
});

// =================================================================
// 3. OBJETS
// =================================================================

describe('Parser : objets', () => {
  it('parse un objet simple', () => {
    const c = parse('server = [\n    host = "localhost",\n    port = 8080,\n    ssl = true\n]');
    expect(c.getString('server.host')).toBe('localhost');
    expect(c.getInt('server.port')).toBe(8080);
    expect(c.getBool('server.ssl')).toBe(true);
  });

  it('parse un objet imbriqué', () => {
    const c = parse(`
      db = [
          pool = [
              min-idle = 5,
              max-active = 20
          ]
      ]
    `);
    expect(c.getInt('db.pool.min-idle')).toBe(5);
    expect(c.getInt('db.pool.max-active')).toBe(20);
  });

  it('parse un objet vide', () => {
    const c = parse('empty = []');
    expect(c.getList('empty')).toEqual([]);
  });

  it('parse un objet sans virgules (newline-separated)', () => {
    const c = parse(`
      server = [
          host = "localhost"
          port = 8080
          ssl = true
      ]
    `);
    expect(c.getString('server.host')).toBe('localhost');
    expect(c.getInt('server.port')).toBe(8080);
    expect(c.getBool('server.ssl')).toBe(true);
  });

  it('parse un objet mixte virgules et newlines', () => {
    const c = parse(`
      cfg = [
          a = 1,
          b = 2
          c = 3,
      ]
    `);
    expect(c.getInt('cfg.a')).toBe(1);
    expect(c.getInt('cfg.b')).toBe(2);
    expect(c.getInt('cfg.c')).toBe(3);
  });

  it('parse un objet imbriqué sans virgules', () => {
    const c = parse(`
      db = [
          pool = [
              min-idle = 5
              max-active = 20
          ]
      ]
    `);
    expect(c.getInt('db.pool.min-idle')).toBe(5);
    expect(c.getInt('db.pool.max-active')).toBe(20);
  });
});

// =================================================================
// 4. LISTES
// =================================================================

describe('Parser : listes', () => {
  it('parse une liste de strings', () => {
    const c = parse('tags = ["web", "api", "production"]');
    expect(c.getList('tags')).toEqual(['web', 'api', 'production']);
  });

  it('parse une liste de nombres', () => {
    const c = parse('nums = [1, 2, 3]');
    expect(c.getList('nums')).toEqual([1, 2, 3]);
  });

  it('parse une liste d\'objets', () => {
    const c = parse(`
      services = [
          [name = "s1", port = 8081],
          [name = "s2", port = 8082]
      ]
    `);
    const list = c.getList('services') as Record<string, unknown>[];
    expect(list.length).toBe(2);
    expect(list[0].name).toBe('s1');
    expect(list[1].port).toBe(8082);
  });

  it('parse une liste avec trailing comma', () => {
    const c = parse('tags = ["a", "b",]');
    expect(c.getList('tags')).toEqual(['a', 'b']);
  });

  it('parse une liste de strings sans virgules (newline-separated)', () => {
    const c = parse('tags = [\n    "web"\n    "api"\n    "production"\n]');
    expect(c.getList('tags')).toEqual(['web', 'api', 'production']);
  });

  it('parse une liste de nombres sans virgules', () => {
    const c = parse('nums = [\n    1\n    2\n    3\n]');
    expect(c.getList('nums')).toEqual([1, 2, 3]);
  });

  it('parse une liste mixte virgules et newlines', () => {
    const c = parse('items = [\n    "a",\n    "b"\n    "c",\n]');
    expect(c.getList('items')).toEqual(['a', 'b', 'c']);
  });

  it('parse une liste d\'objets sans virgules', () => {
    const c = parse(`
      services = [
          [name = "s1", port = 8081]
          [name = "s2", port = 8082]
      ]
    `);
    const list = c.getList('services') as Record<string, unknown>[];
    expect(list.length).toBe(2);
    expect(list[0].name).toBe('s1');
    expect(list[1].port).toBe(8082);
  });
});

// =================================================================
// 5. INTERPOLATION
// =================================================================

describe('Interpolation', () => {
  it('interpolation simple', () => {
    const c = parse('name = "MyApp"\nmsg = "Hello \x24{name}!"');
    expect(c.getString('msg')).toBe('Hello MyApp!');
  });

  it('interpolation multiple', () => {
    const c = parse('app-name = "Demo"\nversion = "1.0"\nmsg = "\x24{app-name} v\x24{version}"');
    expect(c.getString('msg')).toBe('Demo v1.0');
  });

  it('interpolation avec dot-notation', () => {
    const c = parse('server = [host = "localhost", port = 8080]\nurl = "\x24{server.host}:\x24{server.port}"');
    expect(c.getString('url')).toBe('localhost:8080');
  });

  it('erreur E001 : symbole non défini', () => {
    expect(() => parse('x = "\x24{undefined}"')).toThrow(UndefinedSymbolError);
  });

  it('erreur E005 : référence circulaire', () => {
    expect(() => parse('a = "\x24{b}"\nb = "\x24{a}"')).toThrow(CircularReferenceError);
  });
});

// =================================================================
// 6. ERREURS
// =================================================================

describe('Erreurs', () => {
  it('E006 : redéfinition de symbole', () => {
    expect(() => parse('x = 1\nx = 2')).toThrow(SymbolRedefinedError);
  });

  it('E001 : variable non définie dans l\'interpolation', () => {
    expect(() => parse('msg = "\x24{nope}"')).toThrow(UndefinedSymbolError);
  });

  it('E005 : auto-référence', () => {
    expect(() => parse('x = "\x24{x}"')).toThrow(CircularReferenceError);
  });

  it('E005 : cycle de 3', () => {
    expect(() => parse('a = "\x24{b}"\nb = "\x24{c}"\nc = "\x24{a}"')).toThrow(CircularReferenceError);
  });
});

// =================================================================
// 7. VALIDATION
// =================================================================

describe('Validation', () => {
  it('config valide', () => {
    const [ok] = validate('name = "test"\nport = 8080');
    expect(ok).toBe(true);
  });

  it('config invalide', () => {
    const [ok, err] = validate('x = "\x24{undefined}"');
    expect(ok).toBe(false);
    expect(err).toContain('E001');
  });
});

// =================================================================
// 8. UTILITAIRES
// =================================================================

describe('Utilitaires', () => {
  const config = parse(`
    name = "TestApp"
    server = [
        port = 8080,
        host = "0.0.0.0"
    ]
    tags = ["a", "b"]
  `);

  it('to_json', () => {
    const json = to_json(config);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('TestApp');
    expect(parsed.server.port).toBe(8080);
  });

  it('to_flat_json', () => {
    const flat = JSON.parse(to_flat_json(config));
    // to_flat_json sérialise tout en string
    expect(flat['server.port']).toBe('8080');
    expect(flat['server.host']).toBe('0.0.0.0');
    expect(flat['name']).toBe('TestApp');
  });

  it('to_env', () => {
    const env = to_env(config, 'APP_');
    expect(env).toContain('APP_NAME=TestApp');
    expect(env).toContain('APP_SERVER_PORT=8080');
  });

  it('get_all_keys', () => {
    const keys = get_all_keys(config);
    expect(keys).toContain('name');
    expect(keys).toContain('server.port');
    expect(keys).toContain('server.host');
    expect(keys).toContain('tags');
  });

  it('merge_configs', () => {
    const base = parse('a = 1\nb = 2\nc = [d = 3]');
    const override = parse('b = 20\nc = [d = 30, e = 40]');
    const merged = merge_configs(base, override);
    expect(merged.a).toBe(1);
    expect(merged.b).toBe(20);
    expect((merged.c as Record<string, unknown>).d).toBe(30);
    expect((merged.c as Record<string, unknown>).e).toBe(40);
  });

  it('diff_configs', () => {
    const a = parse('x = 1\ny = 2');
    const b = parse('x = 1\nz = 3');
    const diff = diff_configs(a, b);
    expect(diff.onlyInA).toContain('y');
    expect(diff.onlyInB).toContain('z');
    expect(diff.different).toEqual([]);
  });
});

// =================================================================
// 9. API VinokConfig
// =================================================================

describe('VinokConfig API', () => {
  const c = parse(`
    name = "Test"
    count = 42
    enabled = true
    ratio = 3.14
    items = ["a", "b", "c"]
    nested = [level1 = [level2 = "deep"]]
  `);

  it('get() générique', () => {
    expect(c.get('name')).toBe('Test');
    expect(c.get('count')).toBe(42);
  });

  it('getString()', () => {
    expect(c.getString('name')).toBe('Test');
  });

  it('getInt()', () => {
    expect(c.getInt('count')).toBe(42);
  });

  it('getFloat()', () => {
    expect(c.getFloat('ratio')).toBeCloseTo(3.14);
  });

  it('getBool()', () => {
    expect(c.getBool('enabled')).toBe(true);
  });

  it('getList()', () => {
    expect(c.getList('items')).toEqual(['a', 'b', 'c']);
  });

  it('getObject()', () => {
    const obj = c.getObject('nested');
    expect(obj.level1).toBeDefined();
  });

  it('deep get with dot-notation', () => {
    expect(c.get('nested.level1.level2')).toBe('deep');
  });

  it('has()', () => {
    expect(c.has('name')).toBe(true);
    expect(c.has('nonexistent')).toBe(false);
  });

  it('keys()', () => {
    expect(c.keys()).toContain('name');
    expect(c.keys()).toContain('count');
    expect(c.keys().length).toBe(6);
  });

  it('toObject()', () => {
    const obj = c.toObject();
    expect(obj.name).toBe('Test');
    expect(obj.count).toBe(42);
  });

  it('fallback values', () => {
    expect(c.getString('nonexistent', 'default')).toBe('default');
    expect(c.getInt('nonexistent', 99)).toBe(99);
    expect(c.getBool('nonexistent', false)).toBe(false);
  });
});

// =================================================================
// 10. FICHIER COMPLET (example.vinok)
// =================================================================

describe('Fichier complet : full.vinok', () => {
  let config: VinokConfig;

  beforeAll(async () => {
    config = await VinokConfig.load('./examples/full.vinok');
  });

  it('lit les clés de base', () => {
    expect(config.getString('app-name')).toBe('MyAwesomeApp');
    expect(config.getString('version')).toBe('2.1.0');
    expect(config.getString('env')).toBe('production');
  });

  it('lit un multiline string', () => {
    const desc = config.getString('description');
    expect(desc).toContain('multiline description');
    expect(desc).toContain('several lines');
  });

  it('lit les backtick keys', () => {
    expect(config.get('_gh/App-h__')).toBe('values');
    expect(config.getInt('pool size')).toBe(10);
    expect(config.getString('content-type')).toBe('application/json');
    expect(config.getString('X-Custom-Header')).toBe('my-value');
  });

  it('lit les objets imbriqués', () => {
    expect(config.getString('server.host')).toBe('0.0.0.0');
    expect(config.getInt('server.port')).toBe(8080);
    expect(config.getBool('server.compression')).toBe(true);
    expect(config.getString('server.context-path')).toBe('/api/v2');
  });

  it('lit la base de données imbriquée', () => {
    expect(config.getString('database.url')).toContain('postgresql');
    expect(config.getInt('database.pool.min-idle')).toBe(5);
    expect(config.getInt('database.pool.max-active')).toBe(20);
  });

  it('lit la liste de microservices', () => {
    const services = config.getList('microservices') as Record<string, unknown>[];
    expect(services.length).toBe(2);
    expect(services[0].name).toBe('user-service');
    expect(services[1].timeout).toBe(10000);
  });

  it('lit l\'objet features', () => {
    expect(config.getBool('features.new-dashboard')).toBe(true);
    expect(config.getBool('features.beta-feature')).toBe(false);
    expect(config.getBool('features.dark-mode')).toBe(true);
  });

  it('interpolation de la startup message', () => {
    const msg = config.getString('startup-message');
    expect(msg).toBe('Application MyAwesomeApp v2.1.0 started in production mode');
  });

  it('lit null et nombres spéciaux', () => {
    expect(config.get('optional')).toBeNull();
    expect(config.getInt('negative')).toBe(-42);
    expect(config.getFloat('ratio')).toBeCloseTo(3.14159);
  });

  it('interpolation dans une liste', () => {
    const tags = config.getList('tags') as string[];
    expect(tags).toContain('web');
    expect(tags).toContain('v2.1.0');
  });
});

// =================================================================
// 12. COMMENTAIRES DOCSTRING ("""...""")
// =================================================================

describe('Commentaires docstring : """..."""', () => {
  it('un docstring au niveau document est ignoré', () => {
    const c = parse('"""\nCeci est un commentaire\nmulti-ligne\n"""\nname = "MyApp"');
    expect(c.getString('name')).toBe('MyApp');
    expect(c.keys()).toEqual(['name']);
  });

  it('plusieurs docstrings consécutifs sont ignorés', () => {
    const c = parse('"""Premier docstring"""\n"""Deuxième docstring\nsur plusieurs lignes"""\nport = 8080');
    expect(c.getInt('port')).toBe(8080);
    expect(c.keys()).toEqual(['port']);
  });

  it('docstring entre deux assignments', () => {
    const c = parse('name = "App"\n"""Commentaire entre deux clés"""\nversion = "1.0"');
    expect(c.getString('name')).toBe('App');
    expect(c.getString('version')).toBe('1.0');
    expect(c.keys().length).toBe(2);
  });

  it('docstring vide est ignoré', () => {
    const c = parse('""""""\nkey = "value"');
    expect(c.getString('key')).toBe('value');
  });

  it('"""...""" après = reste une string valeur', () => {
    const c = parse('desc = """\nHello World\n"""');
    expect(c.getString('desc')).toBe('Hello World');
  });

  it('"""...""" dans une liste reste une string valeur', () => {
    const c = parse('items = ["""\nmultiline\nin list\n""", "other"]');
    const items = c.getList('items') as string[];
    expect(items[0]).toBe('multiline\nin list');
    expect(items[1]).toBe('other');
  });

  it('le lexer produit bien un token MultiLineString', () => {
    const lex = new Lexer('"""\ncontenu\n"""');
    const tokens = lex.tokenize();
    expect(tokens[0].type).toBe(TokenType.MultiLineString);
    expect(tokens[0].value).toBe('contenu');
  });
});

// =================================================================
// 11. NEWLINE-SEPARATED [] (pkg.vinok)
// =================================================================

describe('Newline-separated brackets : pkg.vinok', () => {
  let config: VinokConfig;

  beforeAll(async () => {
    config = await VinokConfig.load('./examples/pkg.vinok');
  });

  it('parse un objet [] sans virgules (scripts)', () => {
    const scripts = config.getObject('scripts');
    expect(Object.keys(scripts).length).toBe(8);
    expect(scripts['test-utils']).toBe('dv tests/test_utils.dv');
    expect(scripts['test-preprocessing']).toBe('dval tests/test_preprocessing.dv');
    expect(scripts['tutorial']).toBe('dv src/main.dv');
    expect(scripts['quickstart']).toBe('dv examples/quickstart.dv');
  });

  it('parse un objet [] avec virgules (tools)', () => {
    const tools = config.getObject('tools');
    expect(Object.keys(tools).length).toBe(3);
    expect(tools['linter']).toBe('dv tools/linter.dv');
    expect(tools['formatter']).toBe('dval tools/formatter.dv');
    expect(tools['bundler']).toBe('dv tools/bundler.dv');
  });

  it('parse une liste [] sans virgules (authors)', () => {
    const authors = config.getList('authors') as string[];
    expect(authors).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('parse une liste [] avec virgules (keywords)', () => {
    const keywords = config.getList('keywords') as string[];
    expect(keywords).toEqual(['dval', 'quest', 'rpg', 'toolkit']);
  });
});

/**
 * vinok/cli.ts
 * Interface en ligne de commande.
 *
 * Commandes :
 *   bun run src/cli.ts parse <file> [-k key]
 *   bun run src/cli.ts validate <file> [-q]
 *   bun run src/cli.ts export <file> -o <output> [-f json|flat-json|env]
 *   bun run src/cli.ts get <file> <key> [-t string|int|float|bool]
 *   bun run src/cli.ts tokens <file>
 *   bun run src/cli.ts ast <file>
 */

import { VinokConfig } from './config.js';
import { validate } from './validate.js';
import { to_json, to_flat_json, to_env, dump_json, get_all_keys, diff_configs } from './utils.js';
import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { VinokError } from './exceptions.js';

// --- Helpers ---

function print(msg: string): void {
  console.log(msg);
}

function printErr(msg: string): void {
  console.error(msg);
}

/** Affiche une erreur formatée et quitte avec le code d'erreur. */
function die(err: unknown, source?: string, filePath?: string): never {
  if (err instanceof VinokError) {
    printErr(VinokError.format(err, source, filePath));
  } else if (err instanceof Error) {
    printErr(`Error: ${err.message}`);
  } else {
    printErr(`Error: ${String(err)}`);
  }
  process.exit(1);
}

function usage(): void {
  print(`
VINOK CLI - Rich Minimal Config Format

Usage: bun run src/cli.ts <command> [options]

Commands:
  parse <file>           Parse and display config (JSON)
  validate <file>        Validate config file
  export <file>          Export to JSON/ENV
  get <file> <key>       Get a specific value
  tokens <file>          Display lexer tokens
  ast <file>             Display AST

Options:
  -k <key>               Get specific key (parse command)
  -o <path>              Output file path (export command)
  -f <format>            Output format: json | flat-json | env (default: json)
  -t <type>              Type hint: string | int | float | bool
  -q                     Quiet mode (validate)
  -v                     Verbose mode (show stack trace on error)
`);
}

function parseArgs(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith('-')) {
 const key = args[i];
      const val = args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : 'true';
      flags.set(key, val);
      if (val !== 'true') i++;
    } else {
      flags.set(`_arg${flags.get('_count') ?? '0'}`, args[i]);
      flags.set('_count', String(Number(flags.get('_count') ?? '0') + 1));
    }
    i++;
  }
  return flags;
}

async function readFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    printErr(`error: File not found: ${path}`);
    process.exit(1);
  }
  return file.text();
}

// --- Commands ---

async function cmdParse(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const file = flags.get('_arg0');
  if (!file) { printErr('error: Missing file argument.'); usage(); process.exit(1); }

  let source: string;
  try {
    source = await readFile(file);
  } catch (e) { die(e, undefined, file); }

  let config: VinokConfig;
  try {
    config = VinokConfig.parse(source);
  } catch (e) {
    die(e, source, file);
  }

  const key = flags.get('-k');
  if (key) {
    const val = config.get(key);
    print(typeof val === 'string' ? val : JSON.stringify(val, null, 2));
  } else {
    print(to_json(config));
  }
}

async function cmdValidate(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const file = flags.get('_arg0');
  if (!file) { printErr('error: Missing file argument.'); usage(); process.exit(1); }

  let source: string;
  try {
    source = await readFile(file);
  } catch (e) { die(e, undefined, file); }

  const [ok, error] = validate(source);

  if (flags.has('-q')) {
    process.exit(ok ? 0 : 1);
    return;
  }

  if (ok) {
    print('PASSED');
  } else {
    printErr(`FAILED: ${error}`);
    process.exit(1);
  }
}

async function cmdExport(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const file = flags.get('_arg0');
  const output = flags.get('-o');
  const format = (flags.get('-f') ?? 'json') as 'json' | 'flat-json' | 'env';

  if (!file) { printErr('error: Missing file argument.'); usage(); process.exit(1); }

  let source: string;
  try {
    source = await readFile(file);
  } catch (e) { die(e, undefined, file); }

  let config: VinokConfig;
  try {
    config = VinokConfig.parse(source);
  } catch (e) {
    die(e, source, file);
  }

  if (output) {
    await dump_json(config, output, format);
    print(`Exported to ${output}`);
  } else {
    switch (format) {
      case 'flat-json':
        print(to_flat_json(config));
        break;
      case 'env':
        print(to_env(config));
        break;
      default:
        print(to_json(config));
    }
  }
}

async function cmdGet(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const file = flags.get('_arg0');
  const key = flags.get('_arg1');
  const type = flags.get('-t');

  if (!file || !key) { printErr('error: Missing file or key argument.'); usage(); process.exit(1); }

  let source: string;
  try {
    source = await readFile(file);
  } catch (e) { die(e, undefined, file); }

  let config: VinokConfig;
  try {
    config = VinokConfig.parse(source);
  } catch (e) {
    die(e, source, file);
  }

  let val: unknown;
  try {
    switch (type) {
      case 'string': val = config.getString(key); break;
      case 'int':    val = config.getInt(key); break;
      case 'float':  val = config.getFloat(key); break;
      case 'bool':   val = config.getBool(key); break;
      default:       val = config.get(key); break;
    }
  } catch (e) {
    die(e, source, file);
  }

  print(typeof val === 'string' ? val : JSON.stringify(val));
}

async function cmdTokens(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const file = flags.get('_arg0');
  if (!file) { printErr('error: Missing file argument.'); usage(); process.exit(1); }

  let source: string;
  try {
    source = await readFile(file);
  } catch (e) { die(e, undefined, file); }

  let tokens: ReturnType<Lexer['tokenize']>;
  try {
    const lexer = new Lexer(source);
    tokens = lexer.tokenize();
  } catch (e) {
    die(e, source, file);
  }

  for (const token of tokens) {
    print(token.toString());
  }
}

async function cmdAst(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const file = flags.get('_arg0');
  if (!file) { printErr('error: Missing file argument.'); usage(); process.exit(1); }

  let source: string;
  try {
    source = await readFile(file);
  } catch (e) { die(e, undefined, file); }

  let doc: ReturnType<Parser['parse']>;
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    doc = parser.parse();
  } catch (e) {
    die(e, source, file);
  }

  print(doc.describe());
}

// --- Main ---

const command = process.argv[2];
const restArgs = process.argv.slice(3);

try {
  switch (command) {
    case 'parse':    await cmdParse(restArgs); break;
    case 'validate': await cmdValidate(restArgs); break;
    case 'export':   await cmdExport(restArgs); break;
    case 'get':      await cmdGet(restArgs); break;
    case 'tokens':   await cmdTokens(restArgs); break;
    case 'ast':      await cmdAst(restArgs); break;
    default:
      usage();
      if (command) process.exit(1);
  }
} catch (e) {
  if (e instanceof VinokError) {
    printErr(VinokError.format(e));
  } else if (e instanceof Error) {
    printErr(`Error: ${e.message}`);
  } else {
    printErr(`Error: ${String(e)}`);
  }
  process.exit(1);
}

#!/usr/bin/env python3
"""
VINOK CLI Launcher
==================
Python wrapper that delegates to the VINOK TypeScript CLI via Bun.

Usage:
    python vinok.py <command> [options]

Equivalent to:
    bun run <cli_entry> <command> [options]

Configuration is read from 'vinok-conf.json' next to this script.

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
    -f <format>            Output format: json | flat-json | env
    -t <type>              Type hint: string | int | float | bool
    -q                     Quiet mode (validate)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


# --- Config ---

CONFIG_FILENAME = "vinok-conf.json"


def find_config() -> Path:
    """Cherche vinok-conf.json à côté du script courant."""
    script_dir = Path(__file__).resolve().parent
    config_path = script_dir / CONFIG_FILENAME
    if not config_path.is_file():
        print(
            f"error: '{CONFIG_FILENAME}' not found in {script_dir}",
            file=sys.stderr,
        )
        sys.exit(1)
    return config_path


def load_config(config_path: Path) -> dict[str, Any]:
    """Charge et valide la configuration JSON."""
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON in {config_path}: {e}", file=sys.stderr)
        sys.exit(1)
    except OSError as e:
        print(f"error: cannot read {config_path}: {e}", file=sys.stderr)
        sys.exit(1)

    # Validation minimale
    cli_entry = config.get("cli", {}).get("entry")
    if not cli_entry or not isinstance(cli_entry, str):
        print(
            f"error: 'cli.entry' is missing or invalid in {CONFIG_FILENAME}",
            file=sys.stderr,
        )
        sys.exit(1)

    if not Path(cli_entry).is_file():
        print(
            f"error: CLI entry point not found: {cli_entry}",
            file=sys.stderr,
        )
        sys.exit(1)

    return config


def resolve_runtime(config: dict[str, Any]) -> str:
    """Résout le chemin vers le runtime Bun."""
    runtime = config.get("runtime", {})
    bun_bin = runtime.get("bin", "bun")

    # Si c'est un nom simple (pas un chemin absolu), chercher dans le PATH
    if not os.path.isabs(bun_bin):
        found = shutil.which(bun_bin)
        if found is None:
            print(
                f"error: runtime '{bun_bin}' not found in PATH. "
                f"Set 'runtime.bin' to the absolute path of bun in {CONFIG_FILENAME}.",
                file=sys.stderr,
            )
            sys.exit(1)
        return found

    if not Path(bun_bin).is_file():
        print(
            f"error: runtime not found: {bun_bin}",
            file=sys.stderr,
        )
        sys.exit(1)

    return bun_bin


def build_command(
    config: dict[str, Any],
    bun_path: str,
    user_args: list[str],
) -> list[str]:
    """Construit la commande finale à exécuter."""
    cli_entry = config["cli"]["entry"]
    runtime = config.get("runtime", {})
    subcommand = runtime.get("command", "run")

    cmd = [bun_path, subcommand, cli_entry] + user_args
    return cmd


def main() -> None:
    # Pas d'arguments → afficher le help du CLI VINOK
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print(__doc__.strip())
        # Si on a un help générique, on peut aussi forwarder vers le CLI pour le détail
        if len(sys.argv) >= 2 and sys.argv[1] in ("-h", "--help"):
            config_path = find_config()
            config = load_config(config_path)
            bun_path = resolve_runtime(config)
            cmd = build_command(config, bun_path, ["--help"] if sys.argv[1] == "--help" else [])
            subprocess.run(cmd)
        return

    # Version
    if sys.argv[1] in ("-V", "--version"):
        config_path = find_config()
        config = load_config(config_path)
        version = config.get("version", "unknown")
        print(f"vinok v{version}")
        return

    # Charger la config
    config_path = find_config()
    config = load_config(config_path)

    # Résoudre le runtime
    bun_path = resolve_runtime(config)

    # Arguments utilisateur (tout ce qui suit le nom du script)
    user_args = sys.argv[1:]

    # Construire et exécuter la commande
    cmd = build_command(config, bun_path, user_args)

    result = subprocess.run(cmd)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()

import { CliError } from "./ui.js";

export type FlagSpec = Record<string, { type: "boolean" | "string"; short?: string }>;

export interface ParsedArgs {
  flags: Record<string, string | true>;
  /** Positionals, plus unknown options when not strict, in their original order. */
  rest: string[];
  /** Everything after `--`, or null without `--`. */
  tail: string[] | null;
}

export interface ParseMode {
  /** Unknown options are an error instead of being left in `rest`. */
  strict?: boolean;
  /** The first positional and everything after it go to `rest` untouched (a command to run). */
  stopAtPositional?: boolean;
}

export function parseArgs(args: string[], spec: FlagSpec, mode: ParseMode = {}): ParsedArgs {
  const names = new Map<string, string>();
  for (const [name, flag] of Object.entries(spec)) {
    names.set(`--${name}`, name);
    if (flag.short) names.set(`-${flag.short}`, name);
  }

  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") return { flags, rest, tail: args.slice(i + 1) };

    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const option = equals > 0 ? arg.slice(0, equals) : arg;
    const name = names.get(option);
    if (name) {
      if (spec[name]?.type === "boolean") {
        if (equals > 0) throw new CliError(`${option} does not take a value.`);
        flags[name] = true;
      } else {
        const value = equals > 0 ? arg.slice(equals + 1) : args[++i];
        if (value === undefined || value === "") throw new CliError(`${option} expects a value.`);
        flags[name] = value;
      }
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      if (mode.strict) throw new CliError(`Unknown option ${arg}. See ghom-gh --help.`);
      rest.push(arg);
      continue;
    }
    if (mode.stopAtPositional) return { flags, rest: args.slice(i), tail: null };
    rest.push(arg);
  }
  return { flags, rest, tail: null };
}

export function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

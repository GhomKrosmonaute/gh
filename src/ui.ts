import { stripVTControlCharacters } from "node:util";

const colors =
  !("NO_COLOR" in process.env) && ("FORCE_COLOR" in process.env || Boolean(process.stdout.isTTY));

const style = (open: number, close: number) => (text: string) =>
  colors ? `\x1b[${open}m${text}\x1b[${close}m` : text;

export const c = {
  bold: style(1, 22),
  dim: style(2, 22),
  red: style(31, 39),
  green: style(32, 39),
  yellow: style(33, 39),
  cyan: style(36, 39),
};

/** An expected failure: printed as a one-line message, without a stack trace. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

// Status messages go to stderr so stdout stays clean for `--json` and for git's credential protocol.
export function info(message: string): void {
  process.stderr.write(`${c.cyan("›")} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${c.yellow("!")} ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${c.red("✖")} ${message}\n`);
}

export function print(text = ""): void {
  process.stdout.write(`${text}\n`);
}

/** Left-aligned columns; widths ignore ANSI colour codes. */
export function table(rows: string[][], indent = "  "): string {
  const width = (cell: string) => stripVTControlCharacters(cell).length;
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, width(cell));
    });
  }
  return rows
    .map((row) => {
      const cells = row.map((cell, i) =>
        i === row.length - 1 ? cell : cell + " ".repeat((widths[i] ?? 0) - width(cell)),
      );
      return (indent + cells.join("  ")).trimEnd();
    })
    .join("\n");
}

export function ago(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

import { spawn } from "node:child_process";
import { constants } from "node:os";

export interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** Runs a command and collects its output. Rejects only when the command cannot be started. */
export function capture(
  command: string,
  args: string[],
  options: ExecOptions & { input?: string } = {},
): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    // A child that never reads stdin would otherwise surface EPIPE as an unhandled error.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}

/** Runs a command attached to our terminal and resolves with its exit code. */
export function passthrough(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    // Ctrl+C reaches the child through the terminal's process group; we just outlive it so we can
    // report its exit code instead of dying first.
    const ignore = () => {};
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    process.on("SIGINT", ignore);
    process.on("SIGTERM", forward);
    const cleanup = () => {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", forward);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code, signal) => {
      cleanup();
      resolve(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
    });
  });
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

import { spawn } from "node:child_process";
import type { ExecOptions, ExecResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

// Strip ANSI color/cursor escape sequences. Implemented inline to avoid runtime deps.
const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export async function execCommand(opts: ExecOptions): Promise<ExecResult> {
  const { command, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, maxBufferBytes = DEFAULT_MAX_BUFFER } = opts;
  const start = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;
    let overflow = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > maxBufferBytes) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > maxBufferBytes) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const suffix = overflow ? "\n[output truncated: exceeded max buffer]\n" : "";
      resolve({
        stdout: stripAnsi(stdoutChunks.join("")) + (overflow ? suffix : ""),
        stderr: stripAnsi(stderrChunks.join("")) + (overflow ? suffix : ""),
        exitCode: code ?? (timedOut ? 124 : -1),
        durationMs: Date.now() - start,
        timedOut,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: String(err),
        exitCode: -1,
        durationMs: Date.now() - start,
        timedOut: false,
      });
    });
  });
}

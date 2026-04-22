import type { ClassifierInput } from "./types.js";

export type OutputKind = "gradle" | "npm" | "jest" | "pytest" | "junit" | "generic";

export function classify(input: ClassifierInput): OutputKind {
  const cmd = input.command.toLowerCase();
  const head = input.firstKb;

  if (/\b(gradle|gradlew)\b/.test(cmd) || /BUILD (SUCCESSFUL|FAILED)/.test(head)) return "gradle";
  if (/\bnpm\b|\byarn\b|\bpnpm\b/.test(cmd) || /npm ERR!/.test(head)) return "npm";
  if (/\bjest\b|\bvitest\b/.test(cmd) || /PASS\s|FAIL\s/.test(head)) return "jest";
  if (/\bpytest\b/.test(cmd) || /=+ test session starts =+/.test(head)) return "pytest";
  if (/\.xml\b/.test(cmd) && /<testsuite/.test(head)) return "junit";

  return "generic";
}

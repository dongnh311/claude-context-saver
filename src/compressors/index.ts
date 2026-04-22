import type { OutputKind } from "../classifier.js";
import type { Compressor } from "../types.js";
import { genericCompressor } from "./generic.js";

// MVP: gradle/npm/jest/pytest/junit compressors land in M3–M4. For now everything
// routes to generic; classifier result is preserved so the plumbing is ready.
const registry: Partial<Record<OutputKind, Compressor>> = {
  generic: genericCompressor,
};

export function pickCompressor(kind: OutputKind): Compressor {
  return registry[kind] ?? genericCompressor;
}

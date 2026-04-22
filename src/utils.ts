import { estimateTokens } from "./tokens.js";
import type { CompressContext, CompressedResult } from "./types.js";

export function makeResult(
  summary: string,
  body: string,
  fullLog: string,
  context: CompressContext,
): CompressedResult {
  return {
    summary,
    body,
    logId: context.logId,
    truncatedSections: [],
    originalTokens: estimateTokens(fullLog),
    compressedTokens: estimateTokens(body),
  };
}

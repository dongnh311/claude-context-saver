// MVP: chars/4 heuristic — matches GPT/Claude tokenizers within ~15% for English text.
// Good enough for reduction-ratio reporting; swap for tiktoken post-MVP if needed.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

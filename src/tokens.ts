// chars/4 heuristic — matches GPT/Claude tokenizers within ~15% for English text.
// Swap for a proper BPE tokenizer if we ever ship exact billing numbers.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

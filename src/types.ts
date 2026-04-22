export interface ClassifierInput {
  command: string;
  cwd: string;
  exitCode: number;
  firstKb: string;
}

export interface CompressContext {
  maxTokens: number;
  logId: string;
}

export interface TruncatedSection {
  description: string;
  startLine: number;
  endLine: number;
}

export interface CompressedResult {
  summary: string;
  body: string;
  originalTokens: number;
  compressedTokens: number;
  logId: string;
  truncatedSections: TruncatedSection[];
}

export interface Compressor {
  name: string;
  canHandle(input: ClassifierInput): boolean;
  compress(fullLog: string, context: CompressContext): CompressedResult;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export interface ExecOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

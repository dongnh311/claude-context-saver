import { smartRun } from "./smart-run.js";

export interface SmartTestInput {
  framework?: "junit" | "jest" | "pytest" | "go" | "auto";
  pattern?: string;
  cwd?: string;
}

// TODO(M4): auto-detect framework (package.json jest/vitest, pytest.ini, go.mod).
export async function smartTest(input: SmartTestInput): Promise<string> {
  const fw = input.framework && input.framework !== "auto" ? input.framework : "jest";
  const cmd = resolveCommand(fw, input.pattern);
  return smartRun({ command: cmd, cwd: input.cwd });
}

function resolveCommand(fw: string, pattern?: string): string {
  const p = pattern ? ` ${pattern}` : "";
  switch (fw) {
    case "jest":
      return `npx jest${p}`;
    case "pytest":
      return `pytest${p}`;
    case "go":
      return `go test ./...${p}`;
    case "junit":
      return `./gradlew test${p}`;
    default:
      return `${fw}${p}`;
  }
}

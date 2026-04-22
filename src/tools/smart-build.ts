import { smartRun } from "./smart-run.js";

export interface SmartBuildInput {
  tool?: "gradle" | "npm" | "cargo" | "make" | "auto";
  args?: string;
  cwd?: string;
}

// TODO(M3): auto-detect tool via cwd (gradlew, package.json, Cargo.toml, Makefile).
// For now delegates to smartRun using an explicit tool hint.
export async function smartBuild(input: SmartBuildInput): Promise<string> {
  const tool = input.tool && input.tool !== "auto" ? input.tool : "gradle";
  const cmd = resolveCommand(tool, input.args ?? "");
  return smartRun({ command: cmd, cwd: input.cwd });
}

function resolveCommand(tool: string, args: string): string {
  switch (tool) {
    case "gradle":
      return `./gradlew ${args}`.trim();
    case "npm":
      return `npm ${args || "run build"}`.trim();
    case "cargo":
      return `cargo build ${args}`.trim();
    case "make":
      return `make ${args}`.trim();
    default:
      return `${tool} ${args}`.trim();
  }
}

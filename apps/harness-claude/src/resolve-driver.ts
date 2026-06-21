import { AcpDriver } from "./acp-driver.ts";
import type { HarnessDriver } from "./driver.ts";

export type DriverName = "claude" | "acp";

/**
 * Resolves which harness driver to use based on `HARNESS_DRIVER` env.
 * Defaults to "claude" (the MVP behavior). Set `HARNESS_DRIVER=acp` and
 * configure `ACP_COMMAND` / `ACP_ARGS` to use the ACP driver.
 *
 * Claude driver is loaded lazily to avoid pulling in the SDK when ACP is selected.
 */
export async function resolveDriver(name?: string): Promise<HarnessDriver> {
  const choice = (name ?? process.env.HARNESS_DRIVER ?? "claude") as DriverName;
  switch (choice) {
    case "acp":
      return new AcpDriver();
    case "claude": {
      const { ClaudeDriver } = await import("./claude-driver.ts");
      return new ClaudeDriver();
    }
    default:
      throw new Error(`Unknown HARNESS_DRIVER "${choice}". Valid values: claude, acp`);
  }
}

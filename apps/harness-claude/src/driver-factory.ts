import { AcpHarnessDriver } from "./acp-driver.ts";
import { ClaudeSdkHarnessDriver } from "./claude-driver.ts";
import type { HarnessDriver } from "./driver.ts";

/**
 * Creates the appropriate HarnessDriver based on the HARNESS_DRIVER env var.
 *
 * - `"claude"` or unset → ClaudeSdkHarnessDriver (default)
 * - `"acp"` → AcpHarnessDriver (requires ACP_HARNESS_COMMAND)
 */
export function createHarnessDriver(): HarnessDriver {
  const driverName = process.env.HARNESS_DRIVER ?? "claude";

  switch (driverName) {
    case "claude":
      return new ClaudeSdkHarnessDriver();

    case "acp": {
      const command = process.env.ACP_HARNESS_COMMAND;
      if (!command) {
        throw new Error(
          "ACP_HARNESS_COMMAND must be set when HARNESS_DRIVER=acp " +
            "(path to the ACP-compatible agent binary)",
        );
      }
      const args = process.env.ACP_HARNESS_ARGS?.split(" ").filter(Boolean) ?? [];
      return new AcpHarnessDriver({ command, args });
    }

    default:
      throw new Error(
        `Unknown HARNESS_DRIVER="${driverName}". Supported: "claude" (default), "acp".`,
      );
  }
}

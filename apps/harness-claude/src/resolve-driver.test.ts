import { expect, test } from "bun:test";
import { AcpDriver } from "./acp-driver.ts";
import { resolveDriver } from "./resolve-driver.ts";

test("resolveDriver selects acp when configured", async () => {
  const d = await resolveDriver("acp");
  expect(d.name).toBe("acp");
  expect(d).toBeInstanceOf(AcpDriver);
});

test("resolveDriver throws on unknown name", async () => {
  expect(resolveDriver("unknown")).rejects.toThrow("Unknown HARNESS_DRIVER");
});

test("resolveDriver defaults to claude via env", async () => {
  delete process.env.HARNESS_DRIVER;
  // In environments without @anthropic-ai/claude-agent-sdk the dynamic import will fail.
  // When the SDK is present this succeeds and returns a driver named "claude".
  try {
    const d = await resolveDriver();
    expect(d.name).toBe("claude");
  } catch (e) {
    // Expected when SDK isn't installed in this test env.
    expect(String(e)).toContain("claude-agent-sdk");
  }
});

import { expect, test } from "bun:test";
import { AcpHarnessDriver } from "./acp-driver.ts";
import { ClaudeSdkHarnessDriver } from "./claude-driver.ts";
import { createHarnessDriver } from "./driver-factory.ts";

test("createHarnessDriver returns ClaudeSdkHarnessDriver by default", () => {
  delete process.env.HARNESS_DRIVER;
  const driver = createHarnessDriver();
  expect(driver).toBeInstanceOf(ClaudeSdkHarnessDriver);
  expect(driver.name).toBe("claude-sdk");
});

test("createHarnessDriver returns ClaudeSdkHarnessDriver when HARNESS_DRIVER=claude", () => {
  process.env.HARNESS_DRIVER = "claude";
  const driver = createHarnessDriver();
  expect(driver).toBeInstanceOf(ClaudeSdkHarnessDriver);
  delete process.env.HARNESS_DRIVER;
});

test("createHarnessDriver returns AcpHarnessDriver when HARNESS_DRIVER=acp", () => {
  process.env.HARNESS_DRIVER = "acp";
  process.env.ACP_HARNESS_COMMAND = "/usr/bin/fake-agent";
  const driver = createHarnessDriver();
  expect(driver).toBeInstanceOf(AcpHarnessDriver);
  expect(driver.name).toBe("acp");
  delete process.env.HARNESS_DRIVER;
  delete process.env.ACP_HARNESS_COMMAND;
});

test("createHarnessDriver throws on unknown driver name", () => {
  process.env.HARNESS_DRIVER = "unknown-thing";
  expect(() => createHarnessDriver()).toThrow("Unknown HARNESS_DRIVER");
  delete process.env.HARNESS_DRIVER;
});

test("createHarnessDriver throws when HARNESS_DRIVER=acp but no command configured", () => {
  process.env.HARNESS_DRIVER = "acp";
  delete process.env.ACP_HARNESS_COMMAND;
  expect(() => createHarnessDriver()).toThrow("ACP_HARNESS_COMMAND");
  delete process.env.HARNESS_DRIVER;
});

import { expect, test } from "bun:test";
import { isAllowed, matchPattern } from "./access.ts";

test("matchPattern: glob and exact", () => {
  expect(matchPattern("branch.*", "branch.query")).toBe(true);
  expect(matchPattern("branch.*", "branch.export")).toBe(true);
  expect(matchPattern("echo.ping", "echo.ping")).toBe(true);
  expect(matchPattern("echo.ping", "echo.pong")).toBe(false);
  expect(matchPattern("branch.*", "echo.ping")).toBe(false);
});

test("matchPattern: dots are literal, not any-char", () => {
  expect(matchPattern("echo.ping", "echoXping")).toBe(false);
});

test("isAllowed: any grant matches", () => {
  expect(isAllowed("echo.ping", ["branch.*", "echo.*"])).toBe(true);
  expect(isAllowed("branch.query", ["echo.*"])).toBe(false);
});

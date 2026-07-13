---
name: test-conventions
description: How to write and run tests in this repo (Gilly). Read BEFORE adding tests or changing tested code — covers the bun:test runner, the inject-don't-mock philosophy, the per-seam faking cheat-sheet (RuntimeProvider, SDK query, HTTP handlers, in-memory SQLite, async streams), what to test vs skip, and recipes for testing a channel translator, a runtime provider, engine behavior, or a harness route. Triggers: "write a test", "add tests", "how do I test X", "testing", "test patterns", "fake/mock X".
---

# Testing in Gilly

Tests are **`bun:test`, fully offline, and every seam is injectable** — no mocking frameworks, no network, no real Slack/Anthropic calls. Tests live **next to the code** as `*.test.ts`. The whole architecture is built so the interesting logic can be exercised by passing a fake in, not by intercepting modules. See [`coding-conventions`](../coding-conventions/SKILL.md) for the seams these tests target.

## Running

- `bun test` — the whole workspace (recursively finds every `*.test.ts`).
- `bun test apps/control-plane` — one app/dir.
- `bun test --watch` — while iterating.
- Tests are part of "done": `bun run typecheck` + `bun test` + `bun run biome check .` all pass.

## Philosophy

1. **Inject, don't mock.** Every dependency that does I/O is passed in (a constructor/factory arg, a default-valued function param, or a runtime provider). Tests pass a plain fake — no `vi.mock`/`jest.mock`, no module interception.
2. **Pull pure logic out, test it directly** (the "humble object" pattern). The translation/formatting/reduction is a pure function with a colocated test; the I/O shell stays thin and largely untested.
3. **Prefer a real lightweight dependency over a fake** when it's cheap and high-fidelity — e.g. real in-memory SQLite, a real `Bun.serve` on an ephemeral port — instead of hand-rolling a fake.
4. **Assert exact shapes** with `toEqual` (not snapshots).

## The faking cheat-sheet

| Dependency | How to fake it in a test | Canonical example |
| --- | --- | --- |
| `RuntimeProvider` | Object literal implementing `invoke` / `invokeStream` / `healthy` with canned data | `apps/control-plane/src/engine.test.ts` (`fakeRuntime`) |
| SDK `query` | Pass `queryFn` (default-valued param) returning a fake `async function*` of `SDKMessage`s; throw to test the error path | `apps/harness-Codex/src/loop.test.ts` |
| HTTP server | `createServer(runLoop, runStream)` returns a `fetch` handler — call it directly with `new Request(...)`, no socket | `apps/harness-Codex/src/server.test.ts` |
| Database | `createDb(":memory:")` — the real Drizzle/SQLite, fresh per test | `packages/db/src/repo.test.ts`, `engine.test.ts` |
| Async event stream | `async function*` yielding canned `StreamEvent`s; drain with a small `collect()` helper | `engine.test.ts` |
| Real HTTP wire (parsers) | `Bun.serve({ port: 0, fetch })`, then point the client at `server.port`; `server.stop(true)` after | `packages/runtime/src/local.test.ts` |
| A callback's output (e.g. `reply`, `run`) | A spy array the test pushes into (`reply: async (t) => void out.push(t)`) | `engine.test.ts` |
| Zod contract | `Schema.parse(...)` / `safeParse(...)` round-trips | `packages/harness-protocol/src/index.test.ts` |

Idioms worth copying:

```ts
// Fake a RuntimeProvider — canned result + a streamed event list.
function fakeRuntime(result: InvocationResult, events: StreamEvent[] = []): RuntimeProvider {
  return {
    name: "fake",
    async invoke() { return result; },
    async *invokeStream() { yield* events; },
    async healthy() { return true; },
  };
}

// Drain an async iterable for assertions.
const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};
```

## What to test (and what not)

- **Test:** pure helpers (translators, formatters, reducers), state-machine behavior (the engine's session/run + queue/batch), contract schemas, and the parsing of any wire format you own (NDJSON, SSE lines).
- **Don't test:** the thin I/O shells (the Bolt wiring, `Bun.serve` glue, the SDK itself). If a shell has logic worth testing, that's the signal to extract it into a pure helper first.
- **Never:** hit the network, require `ANTHROPIC_API_KEY`, or open a real Slack connection in a test.

## Recipes

- **A new channel translator** → pure function `nativeEvent → MessageInput`; test sourceKey derivation, text cleanup, and edge cases (missing/empty fields). Mirror `slack-translate.test.ts`.
- **A new runtime provider** → for parsing/transport logic, stand up a `Bun.serve({ port: 0 })` that returns canned bytes and assert the provider yields the right events (mirror `local.test.ts`). Don't call a real backend.
- **Engine behavior** → `createDb(":memory:")` + a `fakeRuntime`; assert replies/streamed events and that Session/Run state persisted. To test the **queue/batch**, give the fake an `invokeStream` that enqueues follow-ups on its first call, then assert the second run is the combined batch (see the batch test in `engine.test.ts`).
- **A harness route** → call `createServer(fakeRunLoop, fakeRunStream).fetch(new Request(...))`; assert status codes (e.g. 400 on a bad body) and the response body/stream.

## Conventions

- File: `<name>.test.ts` next to `<name>.ts`. Import from `"bun:test"` (`import { expect, test } from "bun:test"`).
- A new pure helper ships **with** its test in the same change.
- No mocking/snapshot libraries — `bun:test` + injection only.
- Keep each test self-contained (fresh `createDb(":memory:")`, its own fakes); no shared mutable state between tests.

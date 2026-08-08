# Project Gilly — Runtime

The runtime is the sandbox in which the universal harness image runs. The harness drives the agent
loop; the runtime supplies filesystem, shell, network, and process lifecycle.

## Current and future providers

`LocalRuntimeProvider` currently posts the complete `InvocationRequest` to one `HARNESS_URL`. The
single process at that URL contains both Claude and Codex runners and dispatches from the explicit
agent harness ID.

A future sandbox runtime provider will launch that same universal image. Harness choice does not
change the runtime endpoint or image, so the registry has no per-harness URL/image fields. Swapping
`LocalRuntimeProvider` for a sandbox provider must not change the control plane or harness protocol.

```text
Control Plane (Gilly)   → what runs, when, with what access, where results go
   Harness              → universal image with Claude and Codex loops
   Runtime              → local process now; managed sandbox provider later
```

Gilly's Session and Run lifecycle remains above provider-specific runtime state. A stable Gilly
Session workspace can survive a harness change even though harness conversation state starts fresh.

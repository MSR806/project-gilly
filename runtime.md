# Project Gilly — Runtime

**The runtime is the sandbox the harness runs inside. Gilly's runtime is AWS Bedrock AgentCore Runtime — we do not build sandboxes by hand.**

The harness drives the agent loop; the runtime is the isolated box it executes in — filesystem, shell, network, and lifecycle. We use AgentCore's managed per-session microVM so we don't operate sandbox isolation ourselves.

**The runtime stays replaceable.** AgentCore is the one runtime we build now; the architecture lets us swap in another sandbox provider later if a ceiling forces it.

---

## The Layering

```text
Control Plane (Gilly)   →  what runs, when, with what access, where results go     [custom server]
   Harness              →  the agent loop                                           [the harness]
   Runtime              →  the sandbox the harness runs inside                       [AWS Bedrock AgentCore]
```

The control plane picks a harness + runtime pair per run. AgentCore provisions a fresh microVM per session, our harness runs inside it, and the harness reaches the filesystem and shell **through** the runtime.

---

## Why AgentCore Is the Runtime

The runtime layer exists to give each run an isolated, disposable box to work in — and the hardest, riskiest part of that is the isolation itself. AgentCore Runtime hands us exactly that as a managed service: **each session gets its own dedicated microVM, and the whole microVM is terminated and its memory sanitized when the run ends**, so no two runs can ever see each other's data. That single property is the reason to adopt it — it removes the sandbox-isolation engineering we'd otherwise own.

Beyond isolation, it gives each run a real Linux environment — a filesystem and a shell — so an agent can do actual work, with a managed lifecycle that spins the box up per run and tears it down after. And it is framework-agnostic: any harness packaged as a container runs inside it, which keeps the runtime independent of the harness we choose.

The alternative was to **build the sandbox ourselves** — self-hosting Firecracker or Docker isolation, or stitching together a provider like E2B, Daytona, or Modal. That is precisely the undifferentiated heavy lifting AgentCore removes, so for an AWS-centric platform that values managed isolation it is the clear choice. Those providers stay relevant only as the replaceable fallback if a ceiling ever forces a switch.

# Project Gilly — Runtime

**The runtime is the sandbox the harness runs inside. Gilly's runtime is [AWS Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html) — we do not build sandboxes by hand.**

The harness ([Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)) drives the agent loop; the runtime is the isolated box it executes in — filesystem, shell, secrets, network policy, lifecycle. We use AgentCore's managed per-session microVM so we don't operate Firecracker/Docker isolation ourselves.

**Runtime stays pluggable.** AgentCore is the one runtime we build now; the `Runtime` interface lets us swap in E2B / Daytona / Modal / self-hosted later if a ceiling forces it.

---

## The Layering (filled in)

```text
Control Plane (Gilly)   →  what runs, when, with what access, where results go     [custom server]
   Harness              →  the agent loop                                           [Claude Agent SDK]
   Runtime              →  the sandbox the harness runs inside                       [AWS Bedrock AgentCore Runtime]
```

The control plane picks a `(harness, runtime)` pair per run. AgentCore provisions a fresh microVM per session, our harness container runs inside it, and the harness reaches the filesystem and shell **through** the runtime.

---

## The Decision

| | |
| --- | --- |
| **Runtime** | AWS Bedrock AgentCore Runtime (GA since 2025-10-13) |
| **Isolation** | One dedicated microVM per session; memory sanitized on completion |
| **Harness packaging** | ARM64 container image (ECR), HTTP server on port 8080 |
| **Why** | Managed session isolation, native shell exec, MCP hosting, streaming, token vault — exactly our `Runtime` primitives, with a documented Claude Agent SDK path |
| **Build vs. buy** | Buy the box, build the policy — AgentCore gives isolation/exec/lifecycle; Gilly owns egress rules + per-job secret scoping |

---

## What the Runtime Provides

- **Per-session microVM isolation** — dedicated compute/memory/filesystem per session; the whole microVM is terminated and memory sanitized on completion. No cross-session contamination. *This is the headline reason to adopt.*
- **Real Linux filesystem + shell** — standard FS; `ls`, `cat`, `git`, `npm`, `pip`, `cargo` work unmodified. Shell is a first-class API (`InvokeAgentRuntimeCommand`, deterministic; plus interactive PTY).
- **Arbitrary processes & MCP hosting** — run child processes; MCP is a native protocol, so MCP servers run inside the microVM.
- **Streaming + observability** — SSE / WebSocket invoke streaming back to the control plane; CloudWatch + OpenTelemetry traces, metrics, logs; CloudTrail audit.
- **Managed identity / token vault** — AgentCore Identity stores and injects OAuth / API-key credentials so secrets never enter agent code or the model context.
- **Lifecycle** — idle / max-lifetime auto-termination, explicit stop/delete, immutable runtime versions with rollback.
- **Framework- & model-agnostic** — runs the Claude Agent SDK (documented), and is not tied to Bedrock-hosted models — the harness can point at Bedrock Claude or the Anthropic API.

---

## The Runtime Interface

The neutral interface `harness.md` hands off to. AgentCore is the only implementation we build now.

```ts
interface Runtime {
  provision(spec: RuntimeSpec): Promise<WorkspaceHandle>  // boot a session microVM
  exec(handle, cmd): Promise<ExecResult>                  // deterministic shell
  fs(handle): FileSystem                                  // read / write / mount
  injectSecrets(handle, secrets): Promise<void>           // scoped, per-session
  egressPolicy(handle, policy): void                      // network allowlist
  hostMCP(handle, servers): Promise<void>                 // run MCP processes
  streamLogs(handle): AsyncIterable<RuntimeEvent>         // SSE / WebSocket / CloudWatch
  teardown(handle): Promise<void>                         // terminate + sanitize
}

class AgentCoreRuntime implements Runtime { /* the one we build now */ }

// later, only if a ceiling forces it:
class E2BRuntime     implements Runtime {}
class DaytonaRuntime implements Runtime {}
```

The harness receives a `WorkspaceHandle` and never provisions its own box.

---

## Hard Limits (design around these)

| Property | Value | Adjustable |
| --- | --- | --- |
| Compute per session | **2 vCPU / 8 GB** | No |
| Max session duration | 8 hours | Down only |
| Sync request timeout | 15 min | No |
| Streaming (SSE/WS) max | 60 min | No |
| Idle session timeout | 15 min default | Yes |
| Payload (req/resp) | 100 MB | No |
| Container image | ARM64, port 8080, ≤ 2 GB | No |
| Managed persistent disk | **1 GB, Preview** (14-day idle expiry) | No |
| Invoke rate / agent | 25 TPS | Yes (raise) |
| New sessions / endpoint | 100 TPM (container) | Yes (raise) |
| Identity credential providers | 50 OAuth + 50 API-key / account | Yes (raise) |

**Pricing:** consumption-based, per-second — **$0.0895 / vCPU-hour** + **$0.00945 / GB-hour** (idle I/O wait isn't billed as CPU). Identity is free when used via Runtime; Observability bills standard CloudWatch rates.

---

## What AgentCore Gives vs. What Gilly Still Builds

| Our primitive | AgentCore | Who builds the gap |
| --- | --- | --- |
| Provision a box | ✅ `create_agent_runtime` + per-session microVM | — |
| Exec commands | ✅ `InvokeAgentRuntimeCommand` + PTY | — |
| Filesystem | ✅ Real Linux FS (ephemeral / 1 GB managed / EFS-S3) | Pick storage mode; 1 GB cap is a watch-item |
| Host MCP servers | ✅ native MCP protocol | — |
| Stream logs | ✅ SSE/WS + CloudWatch/OTEL | — |
| Lifecycle / teardown | ✅ auto + explicit + versioned | — |
| Session isolation | ✅✅ microVM + memory sanitize | — |
| **Inject scoped secrets** | ⚠️ vault injects, but doesn't *scope* | **Gilly** mints repo-scoped tokens per job; inject per-session (don't pre-register per repo — 50-provider cap) |
| **Enforce egress policy** | ⚠️ no native per-job allowlist | **Gilly** operates VPC + security groups + NAT + Network Firewall domain allowlists |
| **Session ↔ job/user mapping** | ⚠️ not enforced by AgentCore | **Gilly** owns the session-to-run mapping and per-tenant caps |

VPC mode removes default internet — reaching GitHub/public APIs then requires NAT + firewall rules we manage. That plumbing is our egress-control story.

---

## Deploy & Invoke (shape)

```python
# deploy once per harness image (control plane)
ctl = boto3.client("bedrock-agentcore-control")
ctl.create_agent_runtime(
    agentRuntimeName="claude-harness",
    roleArn="arn:aws:iam::…:role/AgentExecutionRole",
    agentRuntimeArtifact={"containerConfiguration": {"containerUri": "…ecr…/claude-harness:latest"}},
    networkConfiguration={"networkMode": "VPC", "...": "..."},
    filesystemConfigurations=[{"sessionStorage": {"mountPath": "/mnt/workspace"}}])

# invoke per run (one session per repo/job)
rt = boto3.client("bedrock-agentcore")
rt.invoke_agent_runtime(agentRuntimeArn=arn,
                        runtimeSessionId=runId,          # our session↔run mapping
                        payload=json.dumps({"task": "..."}).encode())
```

Alternatives: AgentCore CLI / starter toolkit (`bedrock-agentcore` SDK, `@app.entrypoint`), AWS CLI. IaC via CloudFormation (`AWS::BedrockAgentCore::*`), CDK L2 constructs, and a Terraform provider — *verify exact resource names against current docs at build time.*

---

## Why Not Build Sandboxes Manually

| Option | Verdict | Reason |
| --- | --- | --- |
| **AgentCore Runtime** | **Use as runtime** | Managed microVM isolation, native shell + MCP, identity vault, observability, per-second billing — no Firecracker ops |
| E2B / Daytona / Modal | Pluggable fallback | Bigger/configurable compute, larger persistent disk, multi-cloud — keep behind the `Runtime` interface if a ceiling bites |
| Self-host Firecracker/Docker | Avoid for MVP | Exactly the undifferentiated isolation/ops work AgentCore removes |

If we need **> 8 GB compute, large persistent workspaces, multi-cloud, or turnkey domain-egress allowlisting**, the `Runtime` interface lets us drop in E2B/Daytona without touching the harness or control plane.

---

## The Short Version

```text
Buy the box, build the policy.
AgentCore gives per-session microVM isolation, shell, MCP, streaming, lifecycle, token vault.
Gilly owns egress rules, per-job secret scoping, and session↔run mapping.
One runtime now (AgentCore); the Runtime interface keeps it swappable.
One session per repo/job — Fleet fans out into many isolated sessions.
```

---

## Open Questions (runtime-scoped)

1. **Compute ceiling** — is 2 vCPU / 8 GB enough for our heaviest repo/build/test jobs? Prototype one real Fleet job before committing.
2. **Persistent storage** — managed 1 GB (Preview) vs. EFS/S3 BYO for repo checkouts that exceed it; accept shared storage (loses per-session isolation) or keep checkouts ephemeral per run?
3. **Egress design** — VPC + security groups + NAT + Network Firewall allowlist topology; which destinations (GitHub, package mirrors, internal APIs) per agent type?
4. **Secret scoping** — exact flow for minting repo-scoped GitHub tokens per job and injecting them per session (Secrets Manager vs. broker Lambda vs. Identity outbound auth).
5. **Region** — confirm target region supports Runtime + VPC (GA listed ~9; verify current).
6. **Runtime granularity** — one runtime per harness image with many sessions, vs. per-agent runtimes; how endpoints/quota raises (25 TPS, 100 TPM) handle Fleet fan-out.
7. **Streaming back to the control plane** — consume the SSE/WebSocket invoke response directly vs. read from CloudWatch for live run events.
8. **Preview features** — is managed session storage (and AWS Agent Registry) out of Preview by our build date?
```

*Sources: AWS AgentCore developer guide (runtime-how-it-works, runtime-sessions, runtime-filesystem-configurations, runtime-http-protocol-contract, agentcore-vpc, service quotas), the AgentCore GA announcement, the AWS "hosting coding agents on AgentCore" blog, and the AgentCore pricing page. "Firecracker" is blog-stated; official docs say "microVM."*

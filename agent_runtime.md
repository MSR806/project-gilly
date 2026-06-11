
# Project Gilly - Agent Runtime Decision

**Decision:** Use **Claude Agent SDK as the default sandbox runtime** for Project Gilly.

**Architecture:** Keep the **Gilly control plane** as a separate product/platform server, and run Claude agents inside isolated sandboxes as execution workers.

**Status:** Recommended architecture for MVP and near-term product development.

---

## 1. Executive Summary

Project Gilly is an internal platform for building AI agents that do real work and connecting them to the places work already happens. The product goal is to turn scattered AI usage - chat windows, one-off scripts, repeated prompt setups, ad hoc automations - into a shared, governed platform where teams can build an agent once, reuse it everywhere, and let it run safely.

Given that Gilly will have its own control plane server and its own sandbox infrastructure, the best runtime choice is:

```text
Gilly Control Plane
  -> schedules, governs, stores, routes, audits, and coordinates work

Gilly Sandboxes
  -> run Claude Agent SDK workers for each agent run
```

Claude should be the **primary execution runtime**, not the entire product architecture. Gilly should own the platform abstractions: agents, triggers, targets, Fleet, permissions, approvals, tools, MCP registry, skills registry, run history, and audit logs.

This gives Gilly the best balance of speed, power, safety, and long-term flexibility.

---

## 2. Product Context from Project Gilly

The Project Gilly product doc describes Gilly as an **internal platform for building AI agents that do real work** and connecting them to the places where work already happens.

The core product thesis is:

> Build an agent once, reuse it everywhere, and let it run safely on its own.

The product is motivated by the current problem that AI work inside companies is scattered across chat windows and one-off scripts. Prompts are lost, teams rebuild the same automations, and there is no shared system for seeing what is running or trusting it at scale.

Gilly turns that into a governed platform.

### Existing hand-built examples

The product doc mentions agents that have already been built manually:

| Existing agent | What it does | Problem today |
|---|---|---|
| QA agent | Web chat interface that answers questions by looking across repositories | Took weeks to build from scratch |
| Ampy | Slack bot that answers questions from Amplitude dashboards | Took weeks to wire up interface, triggers, data access, deployment |

The product goal is to make these agents configurable in hours instead of rebuilt over weeks.

---

## 3. Product Model

Gilly's agent model can be summarized as:

```text
Build an agent
  -> give it instructions, tools, and skills
  -> connect a trigger
  -> pick where results go
```

An agent is an AI worker built for a specific job, such as:

- reviewing pull requests
- writing weekly reports
- answering team questions
- auditing a codebase
- investigating failing tests
- raising PRs
- summarizing support tickets
- generating campaign reports
- checking standards across repos

The platform lets users configure what the agent does, what it is allowed to touch, and how it starts.

---

## 4. Core Gilly Concepts

### 4.1 Agent

A Gilly agent is a configured AI worker.

It should be represented as a product-native object, not as a Claude-specific object.

Recommended internal abstraction:

```ts
type GillyAgent = {
  id: string
  name: string
  description?: string

  instructions: string
  modelPolicy: ModelPolicy

  tools: ToolRef[]
  mcpServers: MCPServerRef[]
  skills: SkillRef[]
  subagents: SubagentRef[]

  triggers: Trigger[]
  targets: Target[]

  permissions: PermissionPolicy
  approvalPolicy: ApprovalPolicy
  memoryPolicy: MemoryPolicy
  runPolicy: RunPolicy

  ownerTeamId: string
  version: string
  createdBy: string
  updatedBy: string
}
```

Claude Agent SDK should consume this object through an adapter, but Gilly should not store only Claude-native configuration.

---

### 4.2 Instructions

Instructions define the agent's job, scope, and style.

Examples:

- "Review pull requests for security, reliability, and readability."
- "Summarize weekly campaign performance in plain English."
- "Audit selected repositories for a deprecated package and raise PRs to upgrade it."
- "Answer questions using Amplitude dashboards and explain the metric logic."

Instructions should be versioned in Gilly so users can see what changed between agent versions.

---

### 4.3 Tools and MCPs

Tools and MCPs give agents controlled access to internal and external systems.

Examples:

- GitHub
- Slack
- Linear/Jira
- Amplitude
- Datadog
- warehouse/SQL tools
- internal APIs
- documentation search
- repo search
- file system tools
- browser/search tools, if enabled

MCP should be the default integration pattern where possible because it standardizes how agents connect to tools and data sources.

Gilly should own the MCP registry and tool permission model. Claude should receive only the tools that the current run is allowed to use.

---

### 4.4 Skills

Skills are reusable capabilities that can be attached to agents.

Examples:

- PR review skill
- release note writing skill
- dependency upgrade skill
- incident summary skill
- Amplitude analysis skill
- support ticket clustering skill
- migration planning skill
- repo hygiene skill

Skills should be stored in Gilly's skill registry and materialized into the sandbox at runtime.

Claude is a strong fit here because its ecosystem supports reusable skills made of instructions, scripts, and supporting files. However, Gilly should define the product-level skill object and versioning model.

Recommended internal abstraction:

```ts
type GillySkill = {
  id: string
  name: string
  description: string
  version: string
  files: SkillFile[]
  requiredTools?: ToolRef[]
  requiredMCPs?: MCPServerRef[]
  permissionHints?: PermissionHint[]
  ownerTeamId: string
}
```

---

### 4.5 Subagents

Subagents are specialized helpers a main agent can call on.

Examples:

- Security reviewer subagent
- Test failure investigator subagent
- Frontend specialist subagent
- Database migration reviewer subagent
- Analytics interpreter subagent
- Support summarizer subagent

Claude is a strong fit for subagent delegation, especially in coding and repo tasks. Gilly should expose subagents as configurable child capabilities on a main agent.

---

### 4.6 Triggers

Triggers define where work starts.

The product doc identifies these trigger types:

| Trigger | Example |
|---|---|
| Slack bot | Tag `@gilly-review` in a thread and the agent replies there |
| Cron schedule | A report runs every weekday at 9 AM |
| GitHub trigger | A review starts when a PR opens |
| Direct chat | A user opens the platform and talks to the agent |
| Fleet | Select an agent, select repos, and run the same job across all of them |

Triggers should be owned entirely by Gilly's control plane. A Claude sandbox should not decide when jobs exist; it should only execute jobs handed to it by the control plane.

---

### 4.7 Targets

Targets define where results go.

Examples from the product doc:

- back into the Slack thread
- a specific Slack channel
- email
- the web UI
- attached to a PR
- optional silent completion

Targets should be controlled by Gilly. A Claude agent may produce a structured result, but the control plane should decide how and where to publish it.

---

### 4.8 Fleet

Fleet is one of the most important Gilly concepts.

Fleet means running one agent across many repositories or services at once. It is inspired by the Backstage-style internal developer platform model.

Example Fleet tasks:

- upgrade a package everywhere
- apply one migration across all services
- audit security org-wide
- open the same change as PRs across dozens of repos
- check whether standards are followed across repos
- run repo hygiene checks across teams

The product doc states that each repository gets its own agent run and its own outcome:

- PR opened
- blocker reported
- no action needed
- escalated for a human
- done
- failed
- pending
- needs follow-up

This maps extremely well to a control-plane-plus-sandbox architecture.

Recommended Fleet architecture:

```text
Fleet Run
  - selected agent
  - selected repos/services
  - task prompt
  - permissions
  - approval policy

Control Plane
  - expands Fleet run into N child jobs
  - provisions or queues N sandboxes
  - injects repo checkout and allowed secrets
  - attaches allowed tools, MCPs, skills, and subagents
  - starts Claude Agent SDK in each sandbox
  - streams logs and state back
  - aggregates results
  - publishes targets
  - handles retries, approvals, and escalations

Sandbox Job
  - one repo/service/task
  - one Claude agent runtime
  - isolated filesystem
  - isolated shell/CLI
  - scoped credentials
  - structured result back to control plane
```

Fleet should **not** be one giant Claude agent trying to handle many repositories in one context. It should be one control-plane Fleet run that fans out into many independent Claude sandbox jobs.

---

## 5. Architecture Decision

### Decision

Use **Claude Agent SDK as the default sandbox runtime** for Project Gilly.

### Keep Gilly's control plane separate

The control plane should remain a Gilly-owned server responsible for product, governance, orchestration, and persistence.

### Run Claude inside sandboxes

Each agent run should execute in an isolated sandbox with the required repo/files, tools, MCP servers, skills, subagents, and scoped secrets.

### Preserve a runner abstraction

Claude should be the first and primary runner, but Gilly should preserve a generic runner interface so it can add OpenAI, DeepAgents/LangGraph, local models, or specialized workers later.

Recommended framing:

```text
Claude-first, not Claude-only.
```

---

## 6. Recommended System Architecture

```text
+------------------------------------------------------------+
|                    Gilly Control Plane                     |
|------------------------------------------------------------|
| Agent Registry                                             |
| Skill Registry                                             |
| Tool / MCP Registry                                        |
| Trigger Registry                                           |
| Target Registry                                            |
| Fleet Scheduler                                            |
| Approval System                                            |
| Permissions / RBAC                                         |
| Secret Broker                                              |
| Run History                                                |
| Observability / Audit Logs                                 |
| Cost Controls                                              |
+---------------------------+--------------------------------+
                            |
                            | creates sandbox jobs
                            v
+------------------------------------------------------------+
|                    Gilly Sandbox Layer                     |
|------------------------------------------------------------|
| Ephemeral sandbox per run                                  |
| Repo checkout / mounted files                              |
| Scoped environment variables                               |
| Allowed CLI commands                                       |
| Allowed MCP servers                                        |
| Allowed skills and subagents                               |
| Network egress policy                                      |
+---------------------------+--------------------------------+
                            |
                            | starts runtime
                            v
+------------------------------------------------------------+
|                    Claude Agent Runtime                    |
|------------------------------------------------------------|
| Reasoning loop                                             |
| Tool calling                                               |
| File edits                                                 |
| Shell / CLI execution                                      |
| MCP usage                                                  |
| Skill usage                                                |
| Subagent delegation                                        |
| Local planning                                             |
| Test/debug loop                                            |
| Structured result generation                               |
+------------------------------------------------------------+
```

---

## 7. Why Claude Is the Right Default Runtime

Because Gilly already owns the platform layer, the runtime only needs to be excellent at executing agent work inside a sandbox.

Claude is strong at exactly this.

| Runtime capability | Importance for Gilly | Claude fit |
|---|---:|---:|
| Agent loop | Critical | Strong |
| File reading/writing | Critical for engineering and docs agents | Strong |
| Shell / CLI access | Critical for repo work and tests | Strong |
| MCP integrations | Critical for internal tools | Strong |
| Skills | Critical for reusable capabilities | Strong |
| Subagents | Important for complex tasks | Strong |
| Repo understanding | Critical for Fleet/code agents | Strong |
| Long-running task behavior | Important | Strong |
| Permissioning | Critical | Strong when combined with Gilly policies |
| Human approval | Critical | Strong when mediated by Gilly control plane |
| Non-coding tool use | Important | Strong |
| Structured outputs | Important | Good, should be enforced by Gilly adapter |

Claude Agent SDK is especially attractive for Gilly because it behaves like a programmable agentic worker: it can inspect files, call tools, run commands, delegate to subagents, use skills, and work through a task loop until it reaches a useful result.

---

## 8. Division of Responsibilities

### Gilly control plane owns

| Concern | Owner |
|---|---|
| Agent creation UI | Gilly |
| Agent registry | Gilly |
| Agent versioning | Gilly |
| Trigger routing | Gilly |
| Slack/GitHub/cron/direct chat ingestion | Gilly |
| Fleet fan-out | Gilly |
| Fleet result aggregation | Gilly |
| Sandbox provisioning | Gilly infrastructure |
| RBAC / team permissions | Gilly |
| Tool and MCP registry | Gilly |
| Skill registry | Gilly |
| Subagent registry | Gilly |
| Secret brokering | Gilly |
| Approval policy | Gilly |
| Cost limits | Gilly |
| Run dashboard | Gilly |
| Audit logs | Gilly |
| Target publishing | Gilly |
| Retrying failed jobs | Gilly |
| Escalation workflows | Gilly |

### Claude sandbox runner owns

| Concern | Owner |
|---|---|
| Reasoning inside a run | Claude |
| Local task planning | Claude |
| Tool calling | Claude |
| MCP usage | Claude |
| File edits | Claude |
| Shell commands | Claude, constrained by sandbox policy |
| Repo analysis | Claude |
| Skill execution | Claude |
| Subagent delegation | Claude |
| Test/debug loop | Claude |
| Producing final run result | Claude |

This split keeps Gilly product-native while still getting the power of Claude's runtime.

---

## 9. Why Not DeepAgents as the Main Runtime?

DeepAgents/LangGraph is strong when the framework needs to provide orchestration, graph execution, durable state, model abstraction, and complex multi-agent workflows.

Those are valuable capabilities. But in Gilly's clarified architecture, many of those responsibilities already belong to the separate control plane.

Using DeepAgents inside each sandbox may create extra layers:

```text
Gilly control plane
  -> DeepAgents harness
    -> Claude model/runtime behavior
```

Instead, the simpler MVP architecture is:

```text
Gilly control plane
  -> Claude Agent SDK sandbox runner
```

DeepAgents can still be added later if Gilly needs model-agnostic graph workflows inside a single run. It should not be the default first choice if Claude already covers the core sandbox execution needs.

---

## 10. Why Not OpenAI Agents SDK as the Main Runtime?

OpenAI Agents SDK is useful for OpenAI-native workflows, structured agent flows, handoffs, tracing, and lighter-weight agent products.

For Gilly's MVP, the highest-value use cases include repo work, Fleet, PR reviews, codebase audits, package upgrades, tests, shell access, file edits, skills, MCPs, and subagents.

Claude is a better default fit for this sandbox-worker model.

OpenAI can be added later as a specialized runner for:

- OpenAI-native workflows
- structured extraction
- lower-cost summarization
- realtime/voice use cases
- cases where a specific OpenAI model is preferred

But it should not block a Claude-first MVP.

---

## 11. Runner Abstraction

Even if Claude is the default runtime, Gilly should define a generic runner interface.

Example:

```ts
type RunnerInput = {
  runId: string
  agent: GillyAgent
  task: string
  context: RunContext
  repo?: RepoContext
  tools: MaterializedTool[]
  mcpServers: MaterializedMCPServer[]
  skills: MaterializedSkill[]
  subagents: MaterializedSubagent[]
  permissions: EffectivePermissionPolicy
  outputSchema: JSONSchema
}

type RunnerResult = {
  runId: string
  status: 'succeeded' | 'failed' | 'needs_approval' | 'blocked' | 'no_action_needed'
  summary: string
  details?: string
  artifacts?: Artifact[]
  proposedChanges?: ProposedChange[]
  prUrl?: string
  blockerReason?: string
  metrics: {
    startedAt: string
    completedAt?: string
    model?: string
    inputTokens?: number
    outputTokens?: number
    toolCalls?: number
    costUsd?: number
  }
}

interface AgentRunner {
  run(input: RunnerInput): Promise<RunnerResult>
}
```

First implementation:

```ts
class ClaudeSandboxRunner implements AgentRunner {
  async run(input: RunnerInput): Promise<RunnerResult> {
    // Materialize sandbox
    // Write instructions, skills, MCP config, repo context
    // Start Claude Agent SDK
    // Stream events back to control plane
    // Enforce permissions and approval pauses
    // Return structured result
  }
}
```

Future implementations:

```ts
class OpenAISandboxRunner implements AgentRunner {}
class DeepAgentsRunner implements AgentRunner {}
class LocalModelRunner implements AgentRunner {}
```

This avoids vendor lock-in without slowing down the MVP.

---

## 12. Sandbox Runtime Design

Each sandbox should be ephemeral and scoped to a single run or child Fleet job.

### Sandbox should include

- checked-out repository or mounted working directory
- agent instructions
- selected skills
- selected subagents
- selected MCP server configs
- scoped credentials
- allowed environment variables
- output contract
- logging/tracing sidecar
- network egress restrictions
- shell command policy
- max runtime
- max tool calls
- max cost/token budget

### Sandbox should avoid

- long-lived credentials
- shared writable state across unrelated jobs
- unrestricted network access
- unrestricted shell access
- access to all repos by default
- access to all MCP tools by default
- silent publishing to external targets without control-plane authorization

---

## 13. Permission Model

Gilly should enforce permissions at multiple layers.

### Product-level permissions

- Who can create agents?
- Who can edit agents?
- Who can attach tools/MCPs?
- Who can run an agent?
- Which teams can use an agent?
- Which repos can the agent touch?
- Which targets can it publish to?
- Which actions require approval?

### Sandbox-level permissions

- Which filesystem paths are mounted?
- Which commands are allowed?
- Which commands are denied?
- Which network hosts are allowed?
- Which MCP servers are available?
- Which secrets are injected?
- Which GitHub scopes are available?

### Runtime-level permissions

- Which tool calls require approval?
- Which file edits require approval?
- Which PR creation actions require approval?
- Which destructive operations are blocked?

Recommended policy layering:

```text
Org Policy
  -> Team Policy
    -> Agent Policy
      -> Trigger Policy
        -> Run Policy
          -> Sandbox Policy
            -> Runtime Tool Policy
```

Claude can help enforce runtime permissions, but Gilly should be the source of truth.

---

## 14. Approval Model

Gilly should support approvals as a first-class product feature.

Examples requiring approval:

- opening PRs across many repos
- modifying production configs
- running destructive commands
- sending emails to external users
- posting to broad Slack channels
- running expensive Fleet jobs
- accessing sensitive data tools
- executing database writes

Approval result should be persisted in Gilly's audit log.

Suggested approval states:

```ts
type ApprovalState =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
```

---

## 15. Fleet Execution Model

Fleet should be modeled as a parent run with child runs.

```ts
type FleetRun = {
  id: string
  agentId: string
  task: string
  selectedRepos: RepoRef[]
  status: FleetStatus
  childRuns: AgentRun[]
  aggregateSummary?: string
  createdBy: string
  createdAt: string
}
```

Each child run should have a clear outcome.

```ts
type FleetChildOutcome =
  | 'pr_opened'
  | 'completed_no_action'
  | 'blocked'
  | 'failed'
  | 'needs_human_followup'
  | 'pending'
  | 'running'
```

### Fleet lifecycle

```text
1. User selects agent
2. User selects repos/services
3. User provides task
4. Control plane validates permissions
5. Control plane creates Fleet parent run
6. Control plane expands to child jobs
7. Sandbox workers execute Claude agent per repo
8. Child runs stream logs/results back
9. Risky actions pause for approval
10. Control plane aggregates outcomes
11. Results are published to targets
12. Fleet dashboard shows done/failed/pending/follow-up
```

### Fleet example

```text
Task: Upgrade logging SDK to v3 across all Node services

Repos selected: 28

Outcomes:
  - 19 PRs opened
  - 3 no action needed
  - 4 blocked by incompatible dependency
  - 2 failed due to test environment issue

Final target:
  - Fleet dashboard
  - Slack summary
  - PR links attached
```

---

## 16. Non-Coding Agents on Claude

Claude should not be limited to coding tasks. It can run non-coding Gilly agents as well, provided the tools and MCPs are scoped correctly.

| Non-coding agent | Claude suitability | Notes |
|---|---:|---|
| Growth report | Strong | Use analytics/warehouse MCPs and Slack target |
| Ampy-style analytics bot | Strong | Use Amplitude MCP or internal analytics tools |
| Support analysis | Strong | Use ticketing/CRM MCPs |
| Incident summary | Strong | Use Datadog, Slack, GitHub, docs tools |
| Platform ops bot | Strong | Use guarded internal tools and approval policy |
| Stakeholder update writer | Strong | Use data tools + writing skill |
| Daily campaign report | Strong | Use scheduled trigger and Slack/email target |
| Docs generation | Excellent | Use repo/filesystem tools and writing skills |

The main reason to add another model later would be cost/performance optimization, not capability.

---

## 17. MVP Recommendation

### Build first

1. Gilly control plane server
2. Agent registry
3. Trigger registry
4. Target registry
5. Tool/MCP registry
6. Skill registry
7. Claude sandbox runner
8. Run history and logs
9. Basic approval flow
10. Fleet parent/child run model

### Initial supported triggers

- Direct chat
- Slack mention
- GitHub PR trigger
- Manual Fleet run
- Cron schedule

### Initial supported targets

- Web UI
- Slack thread/channel
- GitHub PR comment
- PR creation
- Email/report later if needed

### Initial high-value agents

| Agent | Why first |
|---|---|
| PR review agent | Clear engineering ROI |
| Dev Slack bot | Demonstrates chat-to-action |
| QA repo agent | Reuses existing hand-built pattern |
| Ampy-style analytics bot | Shows non-code capability |
| Growth report | Shows cron + target publishing |
| Upgrade Fleet | Demonstrates differentiated platform value |

---

## 18. Architecture Comparison

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| Claude Agent SDK as sandbox runtime | Strong file/shell/MCP/skills/subagents; excellent for repo work and Fleet child jobs; fast MVP | Vendor-specific runtime; cost may be high for simple tasks | **Use as default** |
| DeepAgents/LangGraph as core harness | Model-agnostic; strong graph orchestration; good for durable workflows | Duplicates parts of Gilly control plane; extra complexity for MVP | Add later only if needed |
| OpenAI Agents SDK as core runtime | Good OpenAI-native agent flows; useful tracing and structured workflows | Less aligned with Claude-style repo/shell/Fleet execution | Optional later runner |
| Custom runtime from scratch | Maximum control | Too slow; unnecessary | Avoid |

---

## 19. Decision Rationale

The key architecture insight is that Gilly has two separate layers:

```text
Product/control layer
Runtime/execution layer
```

If Gilly did not have its own control plane, DeepAgents/LangGraph would be more attractive as a platform harness.

But because Gilly will have:

- a separate server
- its own product schema
- its own scheduler
- its own Fleet model
- its own sandboxes
- its own permissions and approvals
- its own trigger and target routing

Claude Agent SDK is the better choice for the execution layer.

Claude should be used where it is strongest: executing real work inside scoped environments.

---

## 20. Risks and Mitigations

| Risk | Description | Mitigation |
|---|---|---|
| Vendor lock-in | Gilly becomes too Claude-specific | Keep GillyAgent and AgentRunner abstractions vendor-neutral |
| Cost | Claude may be expensive for high-volume simple tasks | Add model policy and cheaper runners later |
| Sandbox escape / unsafe commands | Agent has shell/filesystem access | Use ephemeral sandboxes, command policy, network restrictions, approvals |
| Tool misuse | MCP tools can expose sensitive systems | Tool registry, least privilege, scoped credentials, audit logs |
| Fleet blast radius | Same task across many repos can cause broad damage | Child run isolation, PR-only changes, approval gates, rate limits |
| Poor observability | Hard to debug autonomous runs | Stream events, store logs, capture tool calls, show diffs/artifacts |
| Product abstraction leakage | Users think in Claude concepts instead of Gilly concepts | Hide runtime details behind Gilly UI and schema |
| Non-code overkill | Claude may be excessive for simple summaries | Route simple agents to cheaper runners later |

---

## 21. Recommended Guardrails

### For code-changing agents

- Default to PR creation, not direct merge
- Require approval for large diffs
- Require tests where available
- Store patch/diff artifacts
- Make each repo a separate child run
- Never share writeable workspaces across repos
- Use repo-scoped tokens

### For data agents

- Use read-only credentials by default
- Require approval for writes
- Log generated queries
- Limit row counts
- Mask sensitive fields
- Prefer semantic tools over raw SQL for broad users

### For Slack agents

- Restrict channel access
- Avoid posting broad summaries without confirmation when sensitive
- Store source links
- Support ephemeral/private responses for sensitive answers

### For Fleet

- Require repo selection confirmation
- Estimate blast radius before execution
- Queue and rate-limit jobs
- Provide cancel/pause controls
- Aggregate outcomes clearly
- Support retry per child job

---

## 22. Implementation Sketch

### Control plane services

```text
agent-service
  - create/update/list agents
  - version agent configs

registry-service
  - tools
  - MCP servers
  - skills
  - subagents

trigger-service
  - Slack
  - GitHub
  - cron
  - direct chat
  - Fleet

run-service
  - create runs
  - stream events
  - persist logs
  - track status

fleet-service
  - create parent Fleet run
  - expand child runs
  - aggregate results

approval-service
  - create approval requests
  - block/resume runs
  - audit decisions

sandbox-orchestrator
  - provision sandbox
  - inject repo/context/secrets
  - start Claude runner
  - collect artifacts
```

### Sandbox runner flow

```text
1. Receive RunnerInput from control plane
2. Create isolated workspace
3. Checkout repo or mount files
4. Materialize instructions
5. Materialize skills
6. Start allowed MCP servers
7. Inject scoped secrets
8. Start Claude Agent SDK
9. Stream events/logs/tool calls to control plane
10. Pause when approval required
11. Write final structured result
12. Upload artifacts
13. Destroy sandbox
```

---

## 23. Final Recommendation

Use this architecture:

```text
Primary runtime: Claude Agent SDK
Control plane: Custom Gilly server
Execution environment: Isolated Gilly sandboxes
Fleet model: Gilly scheduler fan-out, one Claude run per repo/service
Product abstraction: Gilly-native agent schema
Future extensibility: AgentRunner interface for additional runtimes
```

The short version:

```text
Claude-first, not Claude-only.
Gilly owns the platform.
Claude runs the work.
Sandboxes enforce the boundary.
Fleet fans out through Gilly, not through one giant agent context.
```

This is the right MVP path because it lets Gilly ship quickly while preserving the long-term ability to add other runners for cost, model preference, or specialized workflows.

---

## 24. Open Questions

These should be answered during implementation design:

1. What sandbox provider will Gilly use?
2. Will sandboxes be per-run, pooled, or hybrid?
3. How will secrets be injected and revoked?
4. What is the first MCP server registry format?
5. What is the skill packaging format?
6. How should subagents be configured in the UI?
7. What actions require approval by default?
8. How will Fleet runs be rate-limited?
9. How will cost be tracked per team/agent/run?
10. What is the minimum viable run dashboard?
11. What structured output schema should every runner return?
12. What retention policy applies to logs, diffs, and artifacts?

---

## 25. Source Notes

This decision is based on:

- The uploaded **Project Gilly** product document, which defines Gilly as an internal governed platform for building reusable agents with instructions, tools/MCPs, skills, subagents, triggers, targets, and Fleet.
- The clarified architecture decision that Gilly will have a separate control plane server and isolated sandboxes where Claude agents are run.
- Publicly available descriptions of Claude/Claude Code-style agent systems, including their support for file and shell work, MCP, skills, hooks, subagents, permissions, and session-oriented execution patterns.


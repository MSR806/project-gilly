# Project Gilly

**Gilly is an internal platform for building AI agents that do real work — and connecting them to the places work already happens.**

Today, AI inside most companies lives in scattered chat windows and one-off scripts. Prompts get lost, every team rebuilds the same automations, and no one can see what's running or trust it at scale. Gilly turns that scattered activity into a shared, governed platform: build an agent once, reuse it everywhere, and let it run safely on its own.

---

## Why a Platform: Weeks → Hours

We've already built agents like this by hand:

- **QA agent** — a web chat interface that answers questions by looking across our different repositories.
- **Ampy** — a Slack bot that answers questions based on our Amplitude dashboards.

Each took **weeks** to build from scratch — wiring up the interface, the triggers, the data access, the deployment.

There are dozens more use cases like these waiting to be built. We shouldn't have to build each one from the ground up. With Gilly, the same kind of agent can be assembled in **a couple of hours, by anyone** — no custom infrastructure, just configuration. The platform is the build effort, done once, so every future agent is cheap.

---

## The Idea in One Picture

```text
Build an agent  →  give it instructions, tools & skills  →  connect a trigger  →  pick where results go
```

An **agent** is an AI worker built for a specific job — reviewing pull requests, writing the weekly report, answering a team's questions, auditing a codebase. You configure what it does, what it's allowed to touch, and how it starts.

---

## Step 1 — Create an Agent

First you create an agent and configure it. These pieces are what turn a blank agent into one built for a specific job:

| Piece | What it is |
| --- | --- |
| **Instructions** | The agent's job, scope, and style |
| **Tools / MCPs** | Controlled access to internal and external systems |
| **Skills** | Reusable capabilities you attach to an agent |
| **Subagents** | Specialized helpers a main agent can call on |
| **Targets** | Where the results land |

That's how you get an agent. People can create as many different types as they need — a PR reviewer, a report writer, a support analyzer, a frontend helper.

---

## Step 2 — Connect It to a Trigger

Once an agent exists, you connect it to wherever the work begins:

- **Slack bot** — tag `@gilly-review` in a thread and the agent replies right there
- **Cron schedule** — a report runs every weekday at 9 AM
- **GitHub trigger** — a review kicks off when a PR opens
- **Direct chat** — open the platform and just talk to the agent
- **Fleet** — select an agent, select the repositories, and trigger it to run the same job across all of them at once

### About Fleet

Fleet is the trigger for running one agent across many repositories or services at once — inspired by Spotify's Backstage. Pick the agent, pick the repos, give the task: upgrade a package everywhere, apply one migration across all services, audit security org-wide, or open the same change as PRs across dozens of repos.

Each repository gets its own agent run with its own outcome — a PR opened, a blocker reported, no action needed, or escalated for a human. The Fleet view tracks all of it: done, failed, pending, needs follow-up.

---

## Where Results Go (Targets)

Back into the Slack thread, a specific channel, an email, the web UI, or attached to a PR. Some agents just do the work and stay quiet — targets are optional.

---

## What It's Good For

**Engineering** — fix bugs, raise PRs, review PRs, summarize changes, investigate failing tests, run dependency upgrades, generate release notes.

**Operations** — weekly health checks, incident summaries, recurring status updates, plain-language reports from internal tools.

**Growth & Business** — daily campaign reports, performance trends, stakeholder updates, answering team questions from analytics and CRM data.

**Platform & DevEx** — team-specific Slack bots, repo hygiene checks, large-scale coordinated changes, and checking whether standards are being followed across repos.

---

## Example Setups

| Setup | How it works |
| --- | --- |
| QA agent | Web chat that answers questions by searching across repositories |
| Ampy | Slack bot that answers questions from Amplitude dashboards |
| PR review agent | Starts on a new PR, posts review notes |
| Dev Slack bot | `@gilly-dev` answers engineering questions, does the work, and raises PRs |
| Growth report | Runs each morning, posts campaign insights to Slack |
| Upgrade fleet | Opens upgrade PRs across selected repos |
| Support analysis | Summarizes tickets and recurring customer issues |
| Platform ops bot | Answers ops questions and runs approved checks |

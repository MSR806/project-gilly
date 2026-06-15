# Project Gilly — Fleet

**Fleet runs one agent across many repositories at once.** You pick an agent, pick a set of repos, and give a task; Fleet spawns a separate run for each repo. See [`control-plane.md`](control-plane.md).

It isn't a listener like a trigger and it isn't a conversation like a channel — it's a fan-out launcher, a manual run multiplied across a target set. Use it to upgrade a package everywhere, apply one migration across all services, audit security org-wide, or open the same change as PRs across dozens of repos.

Each repo gets its own run with its own outcome — a PR opened, a blocker reported, nothing needed, or escalated for a human. The Fleet view tracks the whole set in one place: done, failed, pending, needs follow-up. On a failure you can rerun that repo with extra input rather than restarting the batch.

# Project Gilly — Open Questions & Notes

Loose ends and unresolved tensions to revisit. Not blockers — parking lot for things we've flagged but deliberately deferred.

## Connection vs MCP Registry overlap
The honest flag from the design pass. [`connection.md`](connection.md) (identity + secrets for external systems like GitHub/Jira/Confluence) and the [`mcp-registry.md`](mcp-registry.md) (MCP servers an agent can call) overlap at the edges — the *same* external system could be modeled either way. e.g. GitHub is a Connection (backing a trigger) but could also be an MCP the agent calls to make commits; Jira/Confluence likewise. Need to reconcile: is an MCP a *kind* of connection? Does an MCP reuse a connection's credentials? Today they're separate concepts with no defined relationship.

## Session lifecycle is undocumented
The biggest unwritten piece. Channels depend on it heavily — thread↔session mapping, follow-ups resuming a session with memory, and mid-run message queueing all live here. Triggers and Fleet also produce sessions (and batches) but barely touch the lifecycle. No `session-lifecycle.md` yet.

## Mid-run queueing semantics
[`channel.md`](channel.md) says messages arriving during a run get queued and folded into the live run, but not *how* — appended to the current turn, or held for the next turn? Concurrency and ordering rules are undefined.

## Channel "bound vs open" distinction
Slack is a *bound* channel (one fixed agent chosen at setup); Web is *open* (the user picks which agent to talk to per conversation). Only lightly mentioned in [`channel.md`](channel.md); the difference may deserve fuller treatment.

## "Channel" naming collision
We use "channel" for the conversational surface, which collides with a Slack room (`#releases`). Resolved by convention — always say "Slack channel" for the room — but it's a known sharp edge in UI copy and docs.

## Secrets storage not documented
[`connection.md`](connection.md) says secrets are "stored securely and supplied to a run only when needed," but the actual vault and injection mechanism isn't written up. No `secrets.md` yet.

## Web UI not documented
The configuration + monitoring surface (where all of the above is authored and observed) has no doc

## Target dropped — may re-emerge
We decided not to model "Target" as its own concept. Channels reply in their own thread; a [trigger](trigger.md) optionally carries a "deliver to" destination pointing at a channel. If delivery later gets rich — multiple destinations at once, per-destination formatting, non-channel destinations like standalone email — a first-class Target may be worth reintroducing. 
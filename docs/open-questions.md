# Project Gilly — Open Questions & Notes

Loose ends and unresolved tensions to revisit. Not blockers — parking lot for things we've flagged but deliberately deferred.

## Session lifecycle edge cases
The high-level lifecycle now lives in [`session-lifecycle.md`](session-lifecycle.md): Gilly owns Sessions, Runs, Follow-ups, and Workspaces; AgentCore is only the first runtime provider. Remaining details to define later: cancellation behavior, human approval pauses, how much run-event detail is stored, and whether live Web/voice channels can interrupt instead of queueing.

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

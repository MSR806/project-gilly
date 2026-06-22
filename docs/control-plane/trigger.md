# Project Gilly — Trigger

**A Trigger fires a run when an event happens.** Unlike a channel, it's one-shot: an event occurs, a run is created for an agent, and the trigger is done. See [`control-plane.md`](control-plane.md) and [`connection.md`](connection.md).

To create a trigger you pick a **type**, configure the parameters specific to that type, and write a **user message** — the input handed to the agent when the trigger fires. Every trigger shares the agent + user message; only the event configuration differs by type:

- **GitHub trigger** — configure which **events** to listen for (e.g. PR opened, commit pushed). Built on a [GitHub Connection](connection.md).
- **Cron trigger** — configure the **schedule** (the cron parameters). Stands alone; no connection needed to fire.

A cron is really just a time-based event — same shape as any other trigger, with the schedule taking the place of the event filter. Whatever the type, the trigger's job is the same: on the event, start a run for the chosen agent with the configured message.

Because a trigger has no conversation to reply into, it can optionally carry a **"deliver to"** destination — a [channel](channel.md) (and address, e.g. a Slack room) where the agent's final message is posted. This is the only place delivery is configured; a [channel](channel.md) reply, by contrast, lands in its own thread automatically. Delivery is separate from the work itself: tool actions (opening a PR, commenting, writing to Jira) happen regardless of whether a "deliver to" is set — the destination only governs the final message.

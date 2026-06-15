# Project Gilly — Target

**A Target is where an agent's final message lands.** It's optional — some agents just do the work and stay quiet. See [`control-plane.md`](control-plane.md) and [`connection.md`](connection.md).

A target only governs the agent's *final message*. The work an agent does through its tools and MCPs — opening a PR, commenting, writing to Jira — happens regardless; those are side effects, not the target. The target just decides whether, and where, the agent's closing message is delivered.

Where it can land: back into the conversation it came from (a Slack reply in the same thread), a specific Slack channel, an email, or attached to a PR. When a target posts to an external system it references a [Connection](connection.md) for the identity to deliver as — which is how a cron can post its result to Slack as a particular bot, reusing the same connection a [channel](channel.md) uses.

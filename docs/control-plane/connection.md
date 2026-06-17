# Project Gilly — Connection

**A Connection is a link to an external system, holding its identity and secrets.** It's the foundation the other surfaces build on — channels, triggers, and targets all reference a Connection when they need to reach an outside system. See [`control-plane.md`](control-plane.md).

You connect things once and reuse them. The platform can hold many connections at the same time: several different Slack bots, GitHub, Jira, Confluence, and more as needed. Each is a distinct connection with its own credentials.

A Connection does nothing on its own — it's just identity plus the secrets needed to authenticate. It becomes useful when something references it: a Slack bot connection backs a Slack channel (inbound conversation) and can equally be referenced as a target (outbound delivery); a GitHub connection backs a GitHub trigger; a Jira or Confluence connection gives an agent access to those systems. One connection, many consumers.

Secrets attached to a connection are stored securely and supplied to a run only when it needs them — they are never held on the agent itself.

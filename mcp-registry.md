# Project Gilly — MCP Registry

**The catalog of MCP servers an agent can be granted.** An MCP connection is how an agent reaches a system it doesn't own — internal services or external products — through the Model Context Protocol. See [`control-plane.md`](control-plane.md) and [`agent-registry.md`](agent-registry.md).

Where skills are *instructions*, MCPs are *access*. Attaching an MCP to an agent is what lets it actually touch a system — read Amplitude dashboards, query a database, post to a tool, work with a repo. An agent only reaches what its attached MCPs allow; nothing is ambient.

An MCP is registered once and reused. Some are external products hosted elsewhere (Amplitude, Meta, a vendor's MCP); others are built inside the org and hosted by a team — any org member can stand one up and let others connect agents to it. A connection carries whatever endpoint and credentials it needs to reach its system.

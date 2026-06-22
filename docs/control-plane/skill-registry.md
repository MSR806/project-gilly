# Project Gilly — Skill Registry

**The catalog of reusable skills.** A skill is a packaged capability — instructions plus any supporting scripts or resources — that an agent loads to do a specific kind of work. See [`control-plane.md`](control-plane.md) and [`agent-registry.md`](agent-registry.md).

A skill is the unit of *reuse*: write "how to cut a release" or "how to write our weekly report" once, and every agent that needs it just attaches it. Any org member can author a skill and others reuse it.

A skill is a folder with a main `SKILL.md` plus any number of supporting files — reference docs, scripts, templates. `SKILL.md` carries a **name** and a **description** (a "use this when…" trigger), then the core instructions. The description is the selection criterion: the harness reads it to decide whether the skill is relevant to the current task, so a vague one means the skill is never picked up or fires at the wrong time.

For a long skill, `SKILL.md` acts as an index — core instructions plus pointers to the other files. The harness reads `SKILL.md` first and pulls the referenced files in only when the agent actually needs them (progressive disclosure), so context stays small even when the skill carries a lot of material.

Skills are instructions, not access. What an agent is *allowed to touch* comes from its tools — a skill describes how to do something, not permission to do it.

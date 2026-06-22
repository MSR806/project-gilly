# UI-Managed Agents and Skills Implementation Plan

> **For Hermes:** Use OpenCode to implement this plan against the current `master` branch, then verify and raise a PR.

**Goal:** Move Gilly agent/skill management from code-only config into the web UI, backed by the existing SQLite database, while preserving file-config seeds for bootstrapping.

**Architecture:** Add SQLite tables for `agents`, `skills`, and `agent_skills` in `@gilly/db`, expose CRUD-ish management endpoints from the control-plane web channel, and update the Next.js web UI to list/create skills and agents. Runtime chat continues through `/api/chat`; newly created agents are immediately usable because the engine reads the same in-memory maps that the web channel mutates after successful DB writes.

**Tech Stack:** Bun, TypeScript, Drizzle ORM on `bun:sqlite`, Next.js App Router client pages, existing `@gilly/core` AgentConfig schema and `SkillBundle` harness protocol.

---

## Acceptance Criteria

- Homepage shows both configured agents and available skills.
- User can create a skill from UI by entering a name and `SKILL.md` content.
- User can create an agent from UI by entering id/name/model/system prompt/tools and selecting skills.
- Newly created agents and skills persist in SQLite and are available without editing code/config files.
- Creating an agent with selected skills lets the user open chat with that agent and have the selected skills attached at invocation time.
- Existing config files under `config/agents` and `config/skills` continue to seed the database so current behavior does not disappear.
- Add tests for DB registry functions and management API validation paths.
- Run typecheck/test/lint or report any blocker with exact output.

## Task 1: Add SQLite registry schema and repository functions

**Objective:** Store agents, skills, and their many-to-many relationship in SQLite.

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/repo.ts`
- Modify: `packages/db/src/repo.test.ts`

**Steps:**
1. Add `agents`, `skills`, and `agent_skills` tables.
   - `agents`: `id`, `name`, `model`, `system_prompt`, `tools_json`, `created_at`, `updated_at`.
   - `skills`: `name`, `files_json`, `created_at`, `updated_at`.
   - `agent_skills`: `agent_id`, `skill_name`, `created_at`; composite uniqueness can be enforced by delete/reinsert if Drizzle composite primary keys are awkward.
2. Extend inline migrations in `createDb` with idempotent `CREATE TABLE IF NOT EXISTS` DDL.
3. Add repository functions:
   - `listAgentRows`, `upsertAgentConfig`, `listSkillRows`, `upsertSkillBundle`, `replaceAgentSkillLinks` or equivalent.
   - `loadAgentConfigsFromDb(db): Map<string, AgentConfig>`.
   - `loadSkillBundlesFromDb(db): Map<string, SkillBundle>`.
   - `seedRegistryFromConfig(db, agents, skills)` inserts file-based configs only when missing/upserts them safely.
4. Serialize arrays as JSON strings; validate through `AgentConfig.parse` and `SkillBundle` shape before returning maps.
5. Add bun tests proving agents, skills, links, and reload from SQLite round-trip.

## Task 2: Boot control-plane from SQLite-backed registry

**Objective:** Seed current file configs into SQLite and serve runtime maps from DB-backed data.

**Files:**
- Modify: `apps/control-plane/src/index.ts`
- Modify: `apps/control-plane/src/config.ts` if helper shaping is useful.

**Steps:**
1. Keep loading config files at boot for compatibility.
2. Open DB before final registry construction.
3. Seed file-loaded agents/skills into DB.
4. Build mutable `agents` and `skills` maps from DB, not directly from files.
5. Keep `assertReferencesResolve` after DB load.
6. Pass mutable maps to engine and web channel so POST endpoints can add to them after persistence.

## Task 3: Add management API endpoints

**Objective:** Let UI list/create skills and agents through the control-plane web API.

**Files:**
- Modify: `apps/control-plane/src/channels/web.ts`
- Add/modify tests if a web-channel test file exists; otherwise add focused unit tests for helper validation.

**Endpoints:**
- `GET /api/agents`: return id, name, model, tools, skills.
- `POST /api/agents`: validate body with `AgentConfig`; ensure referenced skills exist; persist to SQLite; update mutable map; return created agent summary.
- `GET /api/skills`: return skill name plus a small preview/metadata, not necessarily every file body.
- `POST /api/skills`: accept `{ name, content }`; create `SkillBundle` with one file `{ path: "SKILL.md", contents: content }`; persist; update mutable skill map; return skill summary.

**Validation:**
- Reject invalid JSON with 400.
- Reject duplicate ids/names with 409 unless deliberately implementing upsert; prefer create semantics for UI.
- Reject agent skill refs not present in the skill map.
- Keep permissive CORS and add methods/headers as needed.

## Task 4: Build the web UI flows

**Objective:** Create a simple but usable UI for viewing skills, creating skills, creating agents, linking skills, and chatting.

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/globals.css`

**Steps:**
1. Fetch `/api/agents` and `/api/skills` on homepage.
2. Render agents list with skill chips and a link/button to `/chat/[id]`.
3. Render skills list with preview.
4. Add “Create skill” form with skill name and `SKILL.md` textarea.
5. Add “Create agent” form with id/name/model/system prompt/tools input and checkbox list of available skills.
6. On successful creation, update local state immediately and show a success message.
7. On agent creation success, expose an obvious “Chat with this agent” link.
8. Keep styling lightweight and consistent with the existing cards/chat UI.

## Task 5: Verification and PR

**Objective:** Prove the feature works and raise a reviewable PR.

**Steps:**
1. Run `bun test`.
2. Run `bun run typecheck`.
3. Run `bun run lint` if practical; if it produces pre-existing formatting churn, run targeted checks and report exact status.
4. Build the web app with `bun run --filter '@gilly/web' build` if dependencies/env allow.
5. Smoke test the control-plane API by starting it (or helper-level tests if harness dependency blocks startup), creating a skill, creating an agent linked to that skill, and verifying GET endpoints show both.
6. Commit with a conventional message.
7. Push branch and open PR against `master` with summary, tests, and known caveats.

## Risks / Notes

- The harness runtime may not be running locally during smoke tests; verify API/DB/UI behavior independently and document if actual chat invocation cannot be exercised.
- Next.js dev may proxy `/api` depending on deployment; the existing UI already uses `/api/agents`, so keep that convention.
- Do not introduce auth/permissions in this PR; current local/dev surface is unauthenticated.

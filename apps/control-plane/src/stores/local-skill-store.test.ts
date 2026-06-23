import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSkillStore } from "./local-skill-store.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "gilly-skills-"));

test("create writes a SKILL.md with frontmatter and lists it", () => {
  const dir = tmp();
  const store = new LocalSkillStore(dir);
  store.create({ name: "deploy", description: "Ship a release.", content: "# Deploy\n\nsteps" });

  expect(store.list()).toEqual([{ name: "deploy", description: "Ship a release." }]);
  const onDisk = readFileSync(join(dir, "deploy", "SKILL.md"), "utf8");
  expect(onDisk).toBe("---\nname: deploy\ndescription: Ship a release.\n---\n\n# Deploy\n\nsteps");
});

test("detail decomposes the stored SKILL.md back into authoring fields", () => {
  const store = new LocalSkillStore(tmp());
  const fields = { name: "deploy", description: "Ship it.", content: "# Deploy\n\nsteps" };
  store.create(fields);
  expect(store.detail("deploy")).toEqual(fields);
  expect(store.detail("missing")).toBeUndefined();
});

test("get returns the bundle the engine ships", () => {
  const store = new LocalSkillStore(tmp());
  store.create({ name: "deploy", description: "Ship.", content: "body" });
  const bundle = store.get("deploy");
  expect(bundle?.name).toBe("deploy");
  expect(bundle?.files[0]?.path).toBe("SKILL.md");
});

test("create rejects duplicates and bad names; update requires existence", () => {
  const store = new LocalSkillStore(tmp());
  store.create({ name: "deploy", description: "d", content: "c" });
  expect(() => store.create({ name: "deploy", description: "d", content: "c" })).toThrow(
    /already exists/,
  );
  expect(() => store.create({ name: "Bad Name", description: "d", content: "c" })).toThrow(
    /Invalid skill name/,
  );
  expect(() => store.update("ghost", { description: "d", content: "c" })).toThrow(/not found/);
});

test("update rewrites the body; delete removes it from disk and cache", () => {
  const dir = tmp();
  const store = new LocalSkillStore(dir);
  store.create({ name: "deploy", description: "old", content: "old body" });
  store.update("deploy", { description: "new", content: "new body" });
  expect(store.detail("deploy")).toEqual({
    name: "deploy",
    description: "new",
    content: "new body",
  });
  store.delete("deploy");
  expect(store.get("deploy")).toBeUndefined();
  expect(store.list()).toEqual([]);
});

test("a fresh store loads skills already on disk", () => {
  const dir = tmp();
  new LocalSkillStore(dir).create({ name: "deploy", description: "d", content: "c" });
  expect(new LocalSkillStore(dir).list()).toEqual([{ name: "deploy", description: "d" }]);
});

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

test("supporting files are written, bundled, and returned by detail", () => {
  const dir = tmp();
  const store = new LocalSkillStore(dir);
  store.create({
    name: "cac",
    description: "Run CAC.",
    content: "# CAC\n\nRun bun .claude/skills/cac/cac.ts",
    files: [{ path: "cac.ts", contents: "console.log('cac')" }],
  });

  expect(readFileSync(join(dir, "cac", "cac.ts"), "utf8")).toBe("console.log('cac')");
  expect(
    store
      .get("cac")
      ?.files.map((f) => f.path)
      .sort(),
  ).toEqual(["SKILL.md", "cac.ts"]);
  expect(store.detail("cac")?.files).toEqual([{ path: "cac.ts", contents: "console.log('cac')" }]);
});

test("update replaces the file set — dropped files disappear from disk", () => {
  const dir = tmp();
  const store = new LocalSkillStore(dir);
  store.create({
    name: "cac",
    description: "d",
    content: "c",
    files: [{ path: "old.ts", contents: "old" }],
  });
  store.update("cac", {
    description: "d",
    content: "c",
    files: [{ path: "new.ts", contents: "n" }],
  });

  expect(existsSync(join(dir, "cac", "old.ts"))).toBe(false);
  expect(existsSync(join(dir, "cac", "new.ts"))).toBe(true);
  expect(store.detail("cac")?.files).toEqual([{ path: "new.ts", contents: "n" }]);
});

test("unsafe file paths are rejected before anything is written", () => {
  const store = new LocalSkillStore(tmp());
  for (const path of ["../escape.ts", "/abs.ts", "SKILL.md", "a/../b.ts"]) {
    expect(() =>
      store.create({
        name: "bad",
        description: "d",
        content: "c",
        files: [{ path, contents: "x" }],
      }),
    ).toThrow(/Invalid skill file path/);
  }
  expect(store.get("bad")).toBeUndefined();
});

test("a fresh store loads skills already on disk", () => {
  const dir = tmp();
  new LocalSkillStore(dir).create({ name: "deploy", description: "d", content: "c" });
  expect(new LocalSkillStore(dir).list()).toEqual([{ name: "deploy", description: "d" }]);
});

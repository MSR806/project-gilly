import { expect, test } from "bun:test";
import { composeSkillMd, isSafeSkillFilePath, parseSkillMd } from "./skill.ts";

test("composeSkillMd emits frontmatter then body", () => {
  expect(composeSkillMd("our-repos", "Use for repos.", "# Repos\n\nbody")).toBe(
    "---\nname: our-repos\ndescription: Use for repos.\n---\n\n# Repos\n\nbody",
  );
});

test("compose → parse round-trips the three fields", () => {
  const fields = { name: "deploy", description: "Ship a release.", content: "# Deploy\n\nsteps" };
  const md = composeSkillMd(fields.name, fields.description, fields.content);
  expect(parseSkillMd(md)).toEqual(fields);
});

test("parseSkillMd tolerates a file with no frontmatter", () => {
  expect(parseSkillMd("# Just a heading\n\ntext")).toEqual({
    name: "",
    description: "",
    content: "# Just a heading\n\ntext",
  });
});

test("isSafeSkillFilePath allows relative paths, rejects traversal/absolute/SKILL.md", () => {
  for (const ok of ["cac.ts", "lib/util.ts", "a/b/c.json"]) {
    expect(isSafeSkillFilePath(ok)).toBe(true);
  }
  for (const bad of ["", "SKILL.md", "/abs.ts", "../x.ts", "a/../b.ts", "a\\b.ts", "./x.ts"]) {
    expect(isSafeSkillFilePath(bad)).toBe(false);
  }
});

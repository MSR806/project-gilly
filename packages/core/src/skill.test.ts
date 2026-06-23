import { expect, test } from "bun:test";
import { composeSkillMd, parseSkillMd } from "./skill.ts";

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

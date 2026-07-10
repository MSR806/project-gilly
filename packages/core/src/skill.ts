/**
 * A skill is authored as three fields (name, description, content) but lives on disk as a single
 * `SKILL.md` with YAML frontmatter the SDK reads. These pure helpers convert between the two.
 */

/** Build a `SKILL.md`: YAML frontmatter (name, description) followed by the content body. */
export function composeSkillMd(name: string, description: string, content: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${content.trimStart()}`;
}

/** A supporting file bundled alongside a skill's SKILL.md (e.g. a script the skill runs). */
export type SkillFile = { path: string; contents: string };

/** A skill decomposed back into its authoring fields. `files` excludes SKILL.md. */
export type SkillFields = {
  name: string;
  description: string;
  content: string;
  files?: SkillFile[];
};

/**
 * A supporting-file path is safe to write under a skill folder: relative, no traversal, and not
 * SKILL.md itself (that's authored via `content`). Trust boundary — paths become filesystem paths.
 */
export function isSafeSkillFilePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\") || path === "SKILL.md") return false;
  return !path.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

/**
 * Parse a `SKILL.md` back into {name, description, content}. Tolerant of missing frontmatter
 * (returns empty name/description and the whole text as content) so a hand-written file still loads.
 */
export function parseSkillMd(md: string): SkillFields {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!match) return { name: "", description: "", content: md.trim() };

  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return {
    name: fields.name ?? "",
    description: fields.description ?? "",
    content: md.slice(match[0].length).trim(),
  };
}

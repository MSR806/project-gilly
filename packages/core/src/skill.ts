/**
 * A skill is authored as three fields (name, description, content) but lives on disk as a single
 * `SKILL.md` with YAML frontmatter the SDK reads. These pure helpers convert between the two.
 */

/** Build a `SKILL.md`: YAML frontmatter (name, description) followed by the content body. */
export function composeSkillMd(name: string, description: string, content: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${content.trimStart()}`;
}

/** A skill decomposed back into its authoring fields. */
export type SkillFields = { name: string; description: string; content: string };

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

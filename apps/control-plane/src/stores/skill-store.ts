import type { SkillFields, SkillFile } from "@gilly/core";
import type { SkillBundle } from "@gilly/harness-protocol";

/**
 * The skill registry seam. Skills are blob content (a `SKILL.md` + supporting files) — kept on the
 * filesystem now ({@link LocalSkillStore}), headed for S3 later. Swapping the backing store is a new
 * class implementing this interface; nothing above it (engine, web channel) changes.
 */
export interface SkillStore {
  /** Lightweight listing for the UI — name + description, no file contents. */
  list(): { name: string; description: string }[];
  /** The full bundle the engine ships to the harness, or undefined if unknown. */
  get(name: string): SkillBundle | undefined;
  /** The authoring fields (name, description, content, files) for an edit form. */
  detail(name: string): SkillFields | undefined;
  /** Author a new skill. Throws if the name already exists. */
  create(input: SkillFields): void;
  /** Replace an existing skill's body and files (name is immutable). Throws if it doesn't exist. */
  update(name: string, input: { description: string; content: string; files?: SkillFile[] }): void;
  delete(name: string): void;
}

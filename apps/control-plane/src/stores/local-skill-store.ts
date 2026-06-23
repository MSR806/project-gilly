import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composeSkillMd, parseSkillMd, type SkillFields } from "@gilly/core";
import type { SkillBundle } from "@gilly/harness-protocol";
import { loadSkills } from "../config.ts";
import type { SkillStore } from "./skill-store.ts";

const SKILL_FILE = "SKILL.md";
/** Skill names become folder names — keep them to a safe slug. */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const skillMd = (bundle: SkillBundle): string =>
  bundle.files.find((f) => f.path === SKILL_FILE)?.contents ?? "";

/**
 * Filesystem-backed {@link SkillStore}. Loads `<dir>/<name>/SKILL.md` folders once at construction
 * (reusing {@link loadSkills}) into an in-memory cache, then keeps disk + cache in step on writes.
 * A single shared instance keeps the engine and web channel consistent in-process.
 */
export class LocalSkillStore implements SkillStore {
  private readonly cache: Map<string, SkillBundle>;

  constructor(private readonly dir: string) {
    this.cache = loadSkills(dir);
  }

  list(): { name: string; description: string }[] {
    return [...this.cache.values()].map((b) => ({
      name: b.name,
      description: parseSkillMd(skillMd(b)).description,
    }));
  }

  get(name: string): SkillBundle | undefined {
    return this.cache.get(name);
  }

  detail(name: string): SkillFields | undefined {
    const bundle = this.cache.get(name);
    if (!bundle) return undefined;
    const { description, content } = parseSkillMd(skillMd(bundle));
    return { name, description, content };
  }

  create(input: SkillFields): void {
    if (!NAME_RE.test(input.name)) {
      throw new Error(
        `Invalid skill name "${input.name}" (use lowercase letters, digits, hyphens)`,
      );
    }
    if (this.cache.has(input.name)) throw new Error(`Skill "${input.name}" already exists`);
    this.write(input.name, input.description, input.content);
  }

  update(name: string, input: { description: string; content: string }): void {
    if (!this.cache.has(name)) throw new Error(`Skill "${name}" not found`);
    this.write(name, input.description, input.content);
  }

  delete(name: string): void {
    rmSync(join(this.dir, name), { recursive: true, force: true });
    this.cache.delete(name);
  }

  /** Compose the SKILL.md, persist it, and refresh the cache entry. */
  private write(name: string, description: string, content: string): void {
    const contents = composeSkillMd(name, description, content);
    const folder = join(this.dir, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, SKILL_FILE), contents);
    this.cache.set(name, { name, files: [{ path: SKILL_FILE, contents }] });
  }
}

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  composeSkillMd,
  isSafeSkillFilePath,
  parseSkillMd,
  type SkillFields,
  type SkillFile,
} from "@gilly/core";
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
    const files = bundle.files.filter((f) => f.path !== SKILL_FILE);
    return { name, description, content, ...(files.length ? { files } : {}) };
  }

  create(input: SkillFields): void {
    if (!NAME_RE.test(input.name)) {
      throw new Error(
        `Invalid skill name "${input.name}" (use lowercase letters, digits, hyphens)`,
      );
    }
    if (this.cache.has(input.name)) throw new Error(`Skill "${input.name}" already exists`);
    this.write(input);
  }

  update(name: string, input: { description: string; content: string; files?: SkillFile[] }): void {
    if (!this.cache.has(name)) throw new Error(`Skill "${name}" not found`);
    this.write({ name, ...input });
  }

  delete(name: string): void {
    rmSync(join(this.dir, name), { recursive: true, force: true });
    this.cache.delete(name);
  }

  /**
   * Compose SKILL.md + write every supporting file, then refresh the cache entry. Rewrites the
   * folder from scratch so files dropped from `input` disappear on disk. Bad paths throw before
   * anything is removed.
   */
  private write({ name, description, content, files = [] }: SkillFields): void {
    for (const f of files) {
      if (!isSafeSkillFilePath(f.path)) throw new Error(`Invalid skill file path "${f.path}"`);
    }
    const folder = join(this.dir, name);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });

    const skillMdContents = composeSkillMd(name, description, content);
    writeFileSync(join(folder, SKILL_FILE), skillMdContents);
    const bundleFiles = [{ path: SKILL_FILE, contents: skillMdContents }];
    for (const f of files) {
      const dest = join(folder, f.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.contents);
      bundleFiles.push({ path: f.path, contents: f.contents });
    }
    this.cache.set(name, { name, files: bundleFiles });
  }
}

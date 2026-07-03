import { z } from "zod";

/**
 * A person who triggers runs, auto-provisioned on first Slack contact. Grants are attached
 * after the fact by an admin; `isAdmin` marks the few who manage users/grants/credentials.
 */
export const User = z.object({
  /** Stable key that grants and traces reference. */
  id: z.string(),
  /** Slack identity — the only identity source for now. */
  slackUserId: z.string(),
  /** Display/real name pulled from Slack so an admin can recognize the person. */
  name: z.string(),
  /** Whatever metadata Slack gives us (email, avatar, …). */
  meta: z.record(z.string(), z.unknown()).optional(),
  isAdmin: z.boolean(),
  createdAt: z.number(),
});

export type User = z.infer<typeof User>;

/** A per-user permission to use tools matching `toolPattern` (e.g. `gmail.*`, `branch.query`). */
export const Grant = z.object({
  id: z.string(),
  userId: z.string(),
  toolPattern: z.string(),
  createdAt: z.number(),
});

export type Grant = z.infer<typeof Grant>;

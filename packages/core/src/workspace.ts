import { z } from "zod";

/** Opaque handle to a runtime-provider workspace (AgentCore session storage, a volume, …). */
export const WorkspaceRef = z.object({
  /** Runtime provider that owns the workspace. */
  provider: z.string(),
  /** Provider-specific id (runtime session id, volume id, …). */
  handle: z.string(),
});

export type WorkspaceRef = z.infer<typeof WorkspaceRef>;

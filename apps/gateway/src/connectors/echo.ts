import { defineConnector, defineTool } from "@gilly/gateway-kit";
import { z } from "zod";

/** Credential-free connector — the end-to-end path that needs no vault entry. */
export const echo = defineConnector({
  name: "echo",
  auth: { kind: "none" },
  tools: [
    defineTool({
      name: "echo.ping",
      description: "Echo the input back",
      input: z.object({ message: z.string() }),
      handler: async (input) => ({ echoed: input.message }),
    }),
  ],
});

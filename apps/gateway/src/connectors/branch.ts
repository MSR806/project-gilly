import { defineConnector, defineTool } from "@gilly/gateway-kit";
import { z } from "zod";

const BRANCH_QUERY_URL = "https://api2.branch.io/v1/query/analytics";

/**
 * Branch.io Analytics Query API — raw pass-through. Key/secret travel in the request body, not a header.
 * The agent composes installs/CPI/CAC from these rows (see the analytics skill), so no compound tools here.
 */
export const branch = defineConnector({
  name: "branch",
  auth: { kind: "api_key" },
  tools: [
    defineTool({
      name: "branch.query",
      description:
        "Query the Branch.io Analytics API. `query` fields: dimensions[], data_source " +
        "(eo_install/eo_reinstall/eo_custom_event/cost/...), aggregation (total_count/unique_count/...), " +
        "granularity (all/day), start_date, end_date (YYYY-MM-DD, range <= 7 days), optional filters. " +
        "Returns install/reinstall/cost/attribution rows.",
      input: z.object({
        query: z.record(z.string(), z.unknown()),
        limit: z.number().int().min(1).max(1000).default(100),
        after: z.string().optional(),
      }),
      creds: ["branch_key", "branch_secret"],
      handler: async ({ query, limit, after }, ctx) => {
        const url = new URL(BRANCH_QUERY_URL);
        url.searchParams.set("limit", String(limit));
        if (after) url.searchParams.set("after", after);
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...query,
            branch_key: ctx.creds.branch_key,
            branch_secret: ctx.creds.branch_secret,
          }),
        });
        // ponytail: Branch validates the query itself (data_source enum, 7-day range) — surface its error, don't re-check locally.
        if (!res.ok) return { error: `Branch Query API failed status=${res.status}` };
        return res.json();
      },
    }),
  ],
});

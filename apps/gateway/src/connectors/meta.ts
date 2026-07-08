import { defineConnector, defineTool } from "@gilly/gateway-kit";
import { z } from "zod";

const GRAPH = "https://graph.facebook.com/v25.0";
// Trust boundary: a marketing token can read more than ads. Restrict to ad-marketing read paths only.
const ALLOWED = [
  /^\/me\/adaccounts$/,
  /^\/act_\d+\/(campaigns|adsets|ads|adcreatives|insights)$/,
  /^\/\d+\/insights$/,
];

/**
 * Meta (Facebook) Marketing Graph API — raw GET pass-through. The agent derives spend/installs/CPI
 * from insights rows via the analytics skill; no compound tools here.
 */
export const meta = defineConnector({
  name: "meta",
  auth: { kind: "api_key" },
  tools: [
    defineTool({
      name: "meta.get",
      description:
        "GET the Meta Marketing (Graph) API. `path` e.g. '/me/adaccounts', '/act_<id>/insights', " +
        "'/act_<id>/campaigns'. `params` is a query object: fields[], level (account/campaign/adset/ad), " +
        "time_range, filtering, action_attribution_windows, etc. Returns spend/installs/campaign rows for CPI/spend analysis.",
      input: z.object({
        path: z.string(),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
      creds: ["access_token"],
      handler: async ({ path, params }, ctx) => {
        if (!ALLOWED.some((re) => re.test(path))) return { error: "path is not allowed" };
        const url = new URL(`${GRAPH}${path}`);
        for (const [k, v] of Object.entries(params)) {
          if (v == null) continue;
          // fields is a comma-list; other objects/arrays (filtering, time_range) go as JSON — matches the Graph API.
          const s =
            k === "fields" && Array.isArray(v)
              ? v.join(",")
              : typeof v === "object"
                ? JSON.stringify(v)
                : String(v);
          url.searchParams.set(k, s);
        }
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${ctx.creds.access_token}` },
        });
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) return { error: `Meta Graph API failed: ${body?.error?.message ?? `status=${res.status}`}` };
        return body;
      },
    }),
  ],
});

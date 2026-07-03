import type { AnyConnector } from "@gilly/gateway-kit";
import { echo } from "./echo.ts";
import { github } from "./github.ts";
import { jira } from "./jira.ts";

export const connectors: AnyConnector[] = [echo, github, jira];

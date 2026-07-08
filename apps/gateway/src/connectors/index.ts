import type { AnyConnector } from "@gilly/gateway-kit";
import { amplitude } from "./amplitude.ts";
import { branch } from "./branch.ts";
import { echo } from "./echo.ts";
import { github } from "./github.ts";
import { jira } from "./jira.ts";
import { meta } from "./meta.ts";

export const connectors: AnyConnector[] = [echo, github, jira, amplitude, branch, meta];

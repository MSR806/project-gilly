"use client";

import Link from "next/link";
import AgentForm from "../AgentForm";

export default function NewAgentPage() {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/agents" className="text-sm text-muted-foreground hover:text-foreground">
        ← Agents
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">New agent</h1>
      <AgentForm mode="create" />
    </div>
  );
}

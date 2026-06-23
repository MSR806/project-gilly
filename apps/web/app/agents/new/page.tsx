"use client";

import Link from "next/link";
import AgentForm from "../AgentForm";

export default function NewAgentPage() {
  return (
    <>
      <Link href="/" className="chat__back">
        ← Back
      </Link>
      <h1 className="page-title">New agent</h1>
      <AgentForm mode="create" />
    </>
  );
}

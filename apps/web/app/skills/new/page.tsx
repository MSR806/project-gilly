"use client";

import Link from "next/link";
import SkillForm from "../SkillForm";

export default function NewSkillPage() {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/skills" className="text-sm text-muted-foreground hover:text-foreground">
        ← Skills
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">New skill</h1>
      <SkillForm mode="create" />
    </div>
  );
}

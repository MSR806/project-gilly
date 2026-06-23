"use client";

import Link from "next/link";
import SkillForm from "../SkillForm";

export default function NewSkillPage() {
  return (
    <>
      <Link href="/" className="chat__back">
        ← Back
      </Link>
      <h1 className="page-title">New skill</h1>
      <SkillForm mode="create" />
    </>
  );
}

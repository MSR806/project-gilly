import ConnectionForm from "../ConnectionForm";

export default function NewConnectionPage() {
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">New channel</h1>
      <ConnectionForm mode="create" />
    </section>
  );
}

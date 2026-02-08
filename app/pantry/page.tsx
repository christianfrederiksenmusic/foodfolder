import PantryClient from "./pantry-client";

export default function PantryPage() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Pantry</h1>
        <p className="mt-2 text-sm text-slate-600">
          Tjek af hvilke basisvarer og krydderier du har. Dette sendes med til opskriftsgeneratoren som “allowed pantry”.
        </p>
      </div>

      <PantryClient />
    </main>
  );
}

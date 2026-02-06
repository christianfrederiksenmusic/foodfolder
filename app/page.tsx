"use client";

import { useState } from "react";

type Item = { name: string; confidence: number };

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function testApi() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fridge", { method: "POST" });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = (await res.json()) as { items: Item[] };
      setItems(data.items ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Qartigo</h1>
      <p style={{ fontSize: 16, marginBottom: 24 }}>
        Foto af køleskab til ugeplan og indkøbsliste.
      </p>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Step 1</h2>
        <p style={{ marginBottom: 12 }}>
          Upload et billede af dit køleskab (v1 tester kun API uden billedet).
        </p>

        <input type="file" accept="image/*" />

        <div style={{ marginTop: 16 }}>
          <button
            onClick={testApi}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: loading ? "#eee" : "#111",
              color: loading ? "#111" : "#fff",
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Tester..." : "Test API"}
          </button>
        </div>

        {error && (
          <p style={{ marginTop: 12, color: "crimson" }}>Fejl: {error}</p>
        )}
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Ingredienser (fra API)</h2>

        {items.length === 0 ? (
          <p style={{ opacity: 0.8 }}>Tryk “Test API” for at hente en liste.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {items.map((it) => (
              <span
                key={it.name}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ccc",
                  fontSize: 14,
                }}
                title={`confidence: ${it.confidence}`}
              >
                {it.name}
              </span>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

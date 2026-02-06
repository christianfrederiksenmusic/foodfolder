"use client";

import { useState } from "react";

type Item = { name: string; confidence: number };
type Meta = { receivedImageBytesApprox?: number };
type ApiResponse = { items: Item[]; meta?: Meta; error?: string };

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  function onFileChange(file: File | null) {
    setError(null);
    setItems([]);
    setMeta(null);
    setImageBase64(null);
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") setImageBase64(result);
      else setError("Kunne ikke læse filen.");
    };
    reader.onerror = () => setError("Kunne ikke læse filen.");
    reader.readAsDataURL(file);
  }

  async function analyzeFridge() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64 }),
      });

      const data = (await res.json()) as ApiResponse;

      if (!res.ok) {
        throw new Error(data.error || `API error: ${res.status}`);
      }

      setItems(data.items ?? []);
      setMeta(data.meta ?? null);
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
          Upload et billede af dit køleskab og tryk “Analyser køleskab”.
        </p>

        <input
          type="file"
          accept="image/*"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />

        <div style={{ marginTop: 16 }}>
          <button
            onClick={analyzeFridge}
            disabled={loading || !imageBase64}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: loading || !imageBase64 ? "#eee" : "#111",
              color: loading || !imageBase64 ? "#111" : "#fff",
              cursor: loading || !imageBase64 ? "default" : "pointer",
            }}
          >
            {loading ? "Analyserer..." : "Analyser køleskab"}
          </button>
        </div>

        {!imageBase64 && (
          <p style={{ marginTop: 10, opacity: 0.7, fontSize: 14 }}>
            Vælg et billede for at aktivere knappen.
          </p>
        )}

        {error && (
          <p style={{ marginTop: 12, color: "crimson" }}>Fejl: {error}</p>
        )}
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Ingredienser (fra API)</h2>

        {items.length === 0 ? (
          <p style={{ opacity: 0.8 }}>
            Upload et billede og tryk “Analyser køleskab”.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
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

            {meta?.receivedImageBytesApprox != null && (
              <p style={{ fontSize: 14, opacity: 0.75 }}>
                Modtog billede (ca.): {meta.receivedImageBytesApprox.toLocaleString()} bytes
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

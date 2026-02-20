"use client";

import Link from "next/link";
import { useState } from "react";
import type { CookbookRecipeSnapshot } from "@/app/types/cookbook";

type Props = {
  recipe: CookbookRecipeSnapshot;
  onSaved?: () => void;
  label?: string;
};

export default function SaveRecipeButton({
  recipe,
  onSaved,
  label = "Gem opskrift",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  async function onSave() {
    setLoading(true);
    setMsg(null);
    setSaved(false);
    setNeedsLogin(false);

    try {
      const res = await fetch("/api/cookbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          setNeedsLogin(true);
          setMsg("Du skal logge ind for at gemme opskrifter.");
        } else {
          setMsg(`Fejl: ${data?.error ?? "Ukendt fejl"}`);
        }
        return;
      }

      setSaved(true);
      setMsg("Opskrift gemt i Min kogebog.");
      onSaved?.();
    } catch {
      setMsg("Netværksfejl. Prøv igen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        onClick={onSave}
        disabled={loading}
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid #111",
          cursor: loading ? "not-allowed" : "pointer",
          width: "fit-content",
          background: "#fff",
        }}
      >
        {loading ? "Gemmer..." : label}
      </button>

      {msg ? (
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: msg.startsWith("Fejl") ? "crimson" : "#333",
          }}
        >
          {msg}
        </p>
      ) : null}

      {saved ? (
        <div style={{ fontSize: 14 }}>
          <Link href="/cookbook" style={{ textDecoration: "underline" }}>
            Åbn Min kogebog
          </Link>
        </div>
      ) : null}

      {needsLogin ? (
        <div style={{ fontSize: 14 }}>
          <Link href="/login" style={{ textDecoration: "underline" }}>
            Gå til login
          </Link>
        </div>
      ) : null}
    </div>
  );
}

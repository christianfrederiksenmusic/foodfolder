"use client";

import { useState } from "react";

export default function SaveTestRecipeButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSave() {
    setLoading(true);
    setMsg(null);

    const res = await fetch("/api/cookbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe: {
          title: "Testopskrift - Cremet tomatpasta",
          summary: "Midlertidig testopskrift til cookbook MVP",
          servings: 2,
          prepTimeMinutes: 10,
          cookTimeMinutes: 15,
          totalTimeMinutes: 25,
          ingredients: [
            { item: "Pasta", amount: "250 g" },
            { item: "Hakkede tomater", amount: "1 dåse" },
            { item: "Løg", amount: "1 stk" },
            { item: "Hvidløg", amount: "2 fed" },
            { item: "Madlavningsfløde", amount: "1 dl" }
          ],
          steps: [
            "Kog pasta i saltet vand.",
            "Sauter løg og hvidløg.",
            "Tilsæt tomat og fløde.",
            "Vend pasta i saucen og servér."
          ],
          missing_items: ["salt", "peber"],
          tags: ["hurtig", "vegetar"],
          timeMinutes: 25,

          tips: ["Smag til med chili og basilikum"],
          sourceType: "ai"
        }
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMsg(`Fejl: ${data?.error ?? "Ukendt fejl"}`);
    } else {
      setMsg("Testopskrift gemt. Opdaterer...");
      window.location.reload();
      return;
    }

    setLoading(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={onSave}
        disabled={loading}
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid #111",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Gemmer..." : "Gem testopskrift"}
      </button>
      {msg ? <p style={{ marginTop: 8 }}>{msg}</p> : null}
    </div>
  );
}

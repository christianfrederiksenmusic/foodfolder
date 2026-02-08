"use client";

import { useEffect, useMemo, useState } from "react";
import { loadPantryValues, savePantryValues } from "./storage";

type PantryItem = { key: string; label: string; value: string };

// Canonical values are what we store + send downstream
const PANTRY_ITEMS: PantryItem[] = [
  { key: "salt", label: "Salt", value: "salt" },
  { key: "pepper", label: "Peber", value: "black pepper" },
  { key: "oil", label: "Olie (neutral/oliven)", value: "cooking oil" },
  { key: "butter", label: "Smør", value: "butter" },
  { key: "vinegar", label: "Eddike", value: "vinegar" },
  { key: "soy_sauce", label: "Sojasauce", value: "soy sauce" },
  { key: "honey", label: "Honning", value: "honey" },
  { key: "sugar", label: "Sukker", value: "sugar" },
  { key: "flour", label: "Hvedemel", value: "wheat flour" },
  { key: "rice", label: "Ris", value: "rice" },
  { key: "pasta", label: "Pasta", value: "pasta" },
  { key: "oats", label: "Havregryn", value: "oats" },
  { key: "breadcrumbs", label: "Rasp", value: "breadcrumbs" },
  { key: "tomato_paste", label: "Tomatpuré", value: "tomato paste" },
  { key: "canned_tomatoes", label: "Hakkede tomater (dåse)", value: "canned tomatoes" },
  { key: "coconut_milk", label: "Kokosmælk", value: "coconut milk" },
  { key: "mustard", label: "Sennep", value: "mustard" },
  { key: "ketchup", label: "Ketchup", value: "ketchup" },
  { key: "mayo", label: "Mayonnaise", value: "mayonnaise" },
  { key: "garlic_powder", label: "Hvidløgspulver", value: "garlic powder" },
  { key: "paprika", label: "Paprika", value: "paprika" },
  { key: "cumin", label: "Spidskommen", value: "cumin" },
  { key: "curry", label: "Karri", value: "curry powder" },
  { key: "chili_flakes", label: "Chiliflager", value: "chili flakes" },
  { key: "oregano", label: "Oregano", value: "oregano" },
  { key: "basil", label: "Basilikum", value: "basil" },
  { key: "thyme", label: "Timian", value: "thyme" },
  { key: "rosemary", label: "Rosmarin", value: "rosemary" },
  { key: "cinnamon", label: "Kanel", value: "cinnamon" },
  { key: "vanilla_sugar", label: "Vaniljesukker", value: "vanilla sugar" },
];

function toSet(values: string[]): Set<string> {
  return new Set((values || []).map(String));
}

export default function PantryClient() {
  const list = useMemo(() => PANTRY_ITEMS, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    // loadPantryValues() also migrates historical wrong formats and writes back
    setSelected(toSet(loadPantryValues()));
  }, []);

  const selectedCount = selected.size;

  function persist(next: Set<string>) {
    savePantryValues(Array.from(next));
  }

  function toggle(value: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      persist(next);
      return next;
    });
  }

  function selectAll() {
    const all = new Set(list.map((x) => x.value));
    setSelected(all);
    persist(all);
  }

  function clearAll() {
    const empty = new Set<string>();
    setSelected(empty);
    persist(empty);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-700">
          Valgt: <span className="font-semibold">{selectedCount}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
          >
            Vælg alle
          </button>
          <button
            onClick={clearAll}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
          >
            Nulstil
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {list.map((it) => {
          const checked = selected.has(it.value);
          return (
            <label
              key={it.key}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(it.value)}
                className="h-4 w-4"
              />
              <span className="text-sm text-slate-800">{it.label}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 text-xs text-slate-500">
        Pantry gemmes lokalt i browseren (localStorage) i canonical format.
      </div>
    </div>
  );
}

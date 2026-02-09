"use client";

import { useEffect, useMemo, useState } from "react";
import { Lang, t } from "../i18n";
import { PANTRY_KEYS, PANTRY_LABELS } from "./catalog";
import { loadPantryValues, savePantryValues } from "./storage";

type PantryItem = { key: string; label: string; value: string };

// Canonical values are what we store + send downstream
const PANTRY_ITEMS = PANTRY_KEYS.map((key) => ({
  key,
  value: key, // stored canonical pantry key
}));

function toSet(values: string[]): Set<string> {
  return new Set((values || []).map(String));
}

export default function PantryClient(props: { lang: Lang }) {
  const list = useMemo(() => PANTRY_ITEMS, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    // loadPantryValues() also migrates historical wrong formats and writes back
    setSelected(toSet(loadPantryValues()));
  });

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
              <span className="text-sm text-slate-800">{PANTRY_LABELS[props.lang][it.key] ?? it.key}</span>
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

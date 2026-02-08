"use client";

export const PANTRY_STORAGE_KEY = "quartigo_pantry_v1";

/**
 * Canonical pantry storage format:
 * - localStorage[PANTRY_STORAGE_KEY] is ALWAYS: string[] of canonical "values"
 *   e.g. ["rice","cooking oil","black pepper"]
 *
 * Historical bug:
 * - Some parts of the app wrote Pantry "keys" (e.g. "oil","pepper") instead of values.
 * This module self-heals by migrating on read and writing back canonical values.
 */

const KEY_TO_VALUE: Record<string, string> = {
  salt: "salt",
  pepper: "black pepper",
  oil: "cooking oil",
  butter: "butter",
  vinegar: "vinegar",
  soy: "soy sauce",
  soy_sauce: "soy sauce",
  honey: "honey",
  sugar: "sugar",
  flour: "wheat flour",
  rice: "rice",
  pasta: "pasta",
  oats: "oats",
  breadcrumbs: "breadcrumbs",
  tomato_paste: "tomato paste",
  canned_tomatoes: "canned tomatoes",
  coconut_milk: "coconut milk",
  mustard: "mustard",
  ketchup: "ketchup",
  mayo: "mayonnaise",
  garlic_powder: "garlic powder",
  paprika: "paprika",
  cumin: "cumin",
  curry: "curry powder",
  chili: "chili flakes",
  chili_flakes: "chili flakes",
  oregano: "oregano",
  basil: "basil",
  thyme: "thyme",
  rosemary: "rosemary",
  cinnamon: "cinnamon",
  vanilla: "vanilla sugar",
  vanilla_sugar: "vanilla sugar",
};

function normalizeValue(x: any): string {
  return String(x ?? "").trim().replace(/\s+/g, " ");
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const n = normalizeValue(v);
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function migrateIfNeeded(arr: any[]): { values: string[]; changed: boolean } {
  let changed = false;

  const mapped = arr
    .map((x) => normalizeValue(x))
    .filter(Boolean)
    .map((s) => {
      const k = s.toLowerCase();
      const mappedValue = KEY_TO_VALUE[k];
      if (mappedValue && mappedValue !== s) changed = true;
      return mappedValue ? mappedValue : s;
    });

  const deduped = dedupeCaseInsensitive(mapped);
  if (deduped.length !== mapped.length) changed = true;

  return { values: deduped, changed };
}

export function loadPantryValues(): string[] {
  try {
    const raw = localStorage.getItem(PANTRY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(parsed) ? parsed : [];
    const { values, changed } = migrateIfNeeded(arr);

    // Self-heal storage: always write canonical values back after migration
    if (changed) {
      try {
        localStorage.setItem(PANTRY_STORAGE_KEY, JSON.stringify(values));
      } catch {
        // ignore
      }
    }

    return values;
  } catch {
    return [];
  }
}

export function savePantryValues(values: string[]) {
  const cleaned = dedupeCaseInsensitive(values || []);
  localStorage.setItem(PANTRY_STORAGE_KEY, JSON.stringify(cleaned));
}

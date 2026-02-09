"use client";

import type { Lang } from "./types";

async function postTranslate(language: Lang, items: string[]): Promise<string[]> {
  if (!items.length) return [];
  const res = await fetch("/api/translate-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language, items }),
  });

  const json: any = await res.json().catch(() => ({}));
  if (json && json.ok === true && Array.isArray(json.items)) {
    return json.items.map((x: any) => String(x ?? "")).filter(Boolean);
  }
  // If API errors, fall back to input.
  return items;
}

export async function translateItems(items: string[], to: Lang): Promise<string[]> {
  const clean = (items || []).map((x) => String(x ?? "").trim()).filter(Boolean);
  return postTranslate(to, clean);
}

export async function translateMap(items: string[], to: Lang): Promise<Record<string, string>> {
  const clean = (items || []).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (!clean.length) return {};
  const translated = await postTranslate(to, clean);
  const out: Record<string, string> = {};
  for (let i = 0; i < clean.length; i++) {
    out[clean[i]] = translated[i] ?? clean[i];
  }
  return out;
}

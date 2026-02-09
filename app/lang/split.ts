// Split user input into query-like items. Intended for free-text add fields.

export function splitItems(input: string): string[] {
  const s = String(input ?? "").trim();
  if (!s) return [];

  // Normalize common separators across languages.
  const normalized = s
    .replace(/\s+&\s+/g, ",")
    .replace(/\s+and\s+/gi, ",")
    .replace(/\s+og\s+/gi, ",")
    .replace(/\s+y\s+/gi, ",")
    .replace(/\s+et\s+/gi, ",")
    .replace(/\s+und\s+/gi, ",")
    .replace(/\s+e\s+/gi, ",")
    .replace(/[\n;|/+]+/g, ",")
    .replace(/,+/g, ",");

  const parts = normalized
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

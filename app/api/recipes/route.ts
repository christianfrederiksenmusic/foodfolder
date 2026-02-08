import { NextResponse } from "next/server";

type ApiItem = { name?: string; confidence?: number; kind?: string; contents?: string };

type Body = {
  language?: string;

  // NEW
  fridge_items?: string[] | unknown;
  pantry_items?: string[] | unknown;

  // LEGACY
  items?: ApiItem[] | unknown;
  pantry?: string[] | unknown;

  constraints?: string;
  count?: number;
};

type Recipe = {
  title: string;
  summary?: string;
  servings?: number;
  time_minutes?: number;
  ingredients: Array<{ item: string; amount: string }>;
  steps: string[];
  tags?: string[];
  missing_items?: string[];
};

function jsonNoStore(body: any, init?: { status?: number }) {
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  res.headers.set("cache-control", "no-store");
  return res;
}

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function stripCodeFences(raw: string): string {
  const t = String(raw ?? "").trim();
  if (t.startsWith("```")) {
    const firstNL = t.indexOf("\n");
    if (firstNL !== -1) {
      const rest = t.slice(firstNL + 1);
      const end = rest.lastIndexOf("```");
      if (end !== -1) return rest.slice(0, end).trim();
    }
  }
  return t;
}

function extractJsonObject(raw: string): string {
  const t0 = stripCodeFences(raw);
  const start = t0.indexOf("{");
  if (start === -1) return t0;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < t0.length; i++) {
    const ch = t0[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    } else {
      if (ch === '"') inStr = true;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return t0.slice(start, i + 1);
      }
    }
  }
  return t0;
}

function clampText(s: any, max = 220): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max).trim() : t;
}

function normalizeItem(s: any): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function dedupeCaseInsensitive(list: string[], max = 120): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const n = normalizeItem(raw);
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

function pickLang(x: unknown): string {
  const s = typeof x === "string" ? x.trim().toLowerCase() : "";
  const allowed = new Set(["da","no","sv","de","en","fr","it","es","pt","ar"]);
  return allowed.has(s) ? s : "en";
}

function pickCount(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return 4;
  return Math.max(1, Math.min(6, Math.floor(n)));
}

function normalizeFridgeItems(body: Body): string[] {
  const fromStrings = Array.isArray(body.fridge_items)
    ? (body.fridge_items as any[]).map((x) => normalizeItem(x))
    : [];
  if (fromStrings.length) return dedupeCaseInsensitive(fromStrings, 60);

  const rawItems = Array.isArray(body.items) ? (body.items as any[]) : [];
  const names = rawItems.map((it: any) => normalizeItem(it?.name ?? "")).filter(Boolean);
  return dedupeCaseInsensitive(names, 60);
}

function normalizePantry(body: Body): string[] {
  const arr = Array.isArray(body.pantry_items)
    ? (body.pantry_items as any[])
    : Array.isArray(body.pantry)
      ? (body.pantry as any[])
      : [];
  const names = arr.map((x) => normalizeItem(x)).filter(Boolean);
  return dedupeCaseInsensitive(names, 80);
}

function isValidRecipe(r: any): r is Recipe {
  if (!r || typeof r !== "object") return false;
  if (typeof r.title !== "string" || r.title.trim().length === 0) return false;
  if (!Array.isArray(r.ingredients) || r.ingredients.length < 5) return false;
  if (!Array.isArray(r.steps) || r.steps.length < 5) return false;

  for (const ing of r.ingredients) {
    if (!ing || typeof ing !== "object") return false;
    if (typeof ing.item !== "string" || ing.item.trim().length === 0) return false;
    if (typeof ing.amount !== "string" || ing.amount.trim().length === 0) return false;
  }
  for (const s of r.steps) {
    if (typeof s !== "string" || s.trim().length === 0) return false;
  }

  if (r.missing_items != null) {
    if (!Array.isArray(r.missing_items)) return false;
    for (const m of r.missing_items) if (typeof m !== "string") return false;
  }

  return true;
}

function buildPrompt(args: { language: string; fridge: string[]; pantry: string[]; constraints: string; count: number }) {
  const { language, fridge, pantry, constraints, count } = args;

  const alwaysAllowed = ["water", "salt", "black pepper", "cooking oil"];
  const allowedPantry = dedupeCaseInsensitive([...alwaysAllowed, ...pantry], 140);

  return `You are a cooking assistant.

Return ONLY valid JSON. No markdown. No extra text.

Generate exactly ${count} complete recipes.

Hard rules:
- Each recipe MUST include:
  - title (string)
  - ingredients: >= 5 entries, each { "amount": string, "item": string }
  - steps: >= 5 concrete steps
  - missing_items: array of strings (can be empty)
- Use mostly fridge ingredients.
- You may add ONLY from this allowed pantry list: ${allowedPantry.join(", ")}.
- Do NOT invent ingredients outside fridge + allowed pantry.
- If you WANT an ingredient that is NOT allowed, do NOT include it in ingredients. Put it in missing_items instead.
- Use metric units where possible (g, ml, tbsp, tsp).
- Language for all text: ${language}.

User constraints:
${constraints ? clampText(constraints, 360) : "(none)"}

Fridge ingredients (confirmed):
${fridge.map((x) => `- ${x}`).join("\n")}

Return JSON with shape:
{"recipes":[{"title":"...","summary":"...","servings":2,"time_minutes":20,"ingredients":[{"amount":"...","item":"..."}],"steps":["..."],"missing_items":["..."],"tags":["..."]}]}
`;
}

async function callAnthropic(apiKey: string, model: string, prompt: string, temperature: number) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1900,
      temperature,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const rawText = await res.text();
  const top = safeJsonParse(rawText);
  return { ok: res.ok, status: res.status, rawText, top };
}

function extractAssistantText(top: any): string {
  const blocks = Array.isArray(top?.content) ? top.content : [];
  const texts = blocks
    .filter((b: any) => b?.type === "text" && typeof b?.text === "string")
    .map((b: any) => b.text);
  return texts.join("\n").trim();
}

function clampRecipeToAllowed(r: Recipe, allowedLower: Set<string>): Recipe {
  const missing: string[] = [];

  const ingredients: Array<{ item: string; amount: string }> = [];
  for (const ing of r.ingredients || []) {
    const item = normalizeItem((ing as any)?.item);
    const amount = normalizeItem((ing as any)?.amount);
    if (!item || !amount) continue;

    const key = item.toLowerCase();
    if (allowedLower.has(key)) ingredients.push({ item, amount });
    else missing.push(item);
  }

  if (Array.isArray(r.missing_items)) {
    for (const m of r.missing_items) {
      const n = normalizeItem(m);
      if (!n) continue;
      const key = n.toLowerCase();
      if (!allowedLower.has(key)) missing.push(n);
    }
  }

  return {
    ...r,
    title: normalizeItem(r.title),
    summary: r.summary ? clampText(r.summary, 260) : undefined,
    ingredients,
    steps: (r.steps || []).map((s) => clampText(s, 260)).filter(Boolean),
    missing_items: dedupeCaseInsensitive(missing, 40),
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonNoStore({ ok: false, error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const language = pickLang(body.language);
  const count = pickCount(body.count);
  const constraints = clampText(body.constraints ?? "", 500);

  const fridge = normalizeFridgeItems(body);
  if (fridge.length === 0) return jsonNoStore({ ok: false, error: "No fridge_items provided" }, { status: 400 });

  const pantry = normalizePantry(body);

  const alwaysAllowed = ["water", "salt", "black pepper", "cooking oil"];
  const allowed = dedupeCaseInsensitive([...alwaysAllowed, ...pantry, ...fridge], 240);
  const allowedLower = new Set(allowed.map((x) => x.toLowerCase()));

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const prompt1 = buildPrompt({ language, fridge, pantry, constraints, count });
  const a1 = await callAnthropic(apiKey, model, prompt1, 0.2);

  if (!a1.ok) {
    const apiError = a1.top?.error?.message || a1.top?.error || a1.top || a1.rawText;
    return jsonNoStore({ ok: false, error: `Anthropic error ${a1.status}`, raw: apiError }, { status: 502 });
  }

  const t1 = a1.top ? extractAssistantText(a1.top) : a1.rawText;
  const parsed1 = safeJsonParse(extractJsonObject(t1));
  const recipes1 = Array.isArray(parsed1?.recipes) ? parsed1.recipes : [];

  const valid1: Recipe[] = recipes1
    .filter(isValidRecipe)
    .map((r: Recipe) => clampRecipeToAllowed(r, allowedLower))
    .filter((r: Recipe) => isValidRecipe(r));

  if (valid1.length > 0) return jsonNoStore({ ok: true, recipes: valid1.slice(0, count) });

  // Repair pass
  const prompt2 = `Fix the output to match the JSON shape strictly.
Rules: JSON only. recipes[].ingredients >= 5 with amount+item. recipes[].steps >= 5. recipes[].missing_items (array, can be empty). Remove duplicates.
Do NOT invent ingredients outside allowed list. If you want something else, put it in missing_items.

Allowed ingredients:
${allowed.join(", ")}

Broken output:
${t1 || "(empty)"}
`;

  const a2 = await callAnthropic(apiKey, model, prompt2, 0);

  if (!a2.ok) {
    const apiError = a2.top?.error?.message || a2.top?.error || a2.top || a2.rawText;
    return jsonNoStore({ ok: false, error: `Anthropic error ${a2.status}`, raw: apiError }, { status: 502 });
  }

  const t2 = a2.top ? extractAssistantText(a2.top) : a2.rawText;
  const parsed2 = safeJsonParse(extractJsonObject(t2));
  const recipes2 = Array.isArray(parsed2?.recipes) ? parsed2.recipes : [];

  const valid2: Recipe[] = recipes2
    .filter(isValidRecipe)
    .map((r: Recipe) => clampRecipeToAllowed(r, allowedLower))
    .filter((r: Recipe) => isValidRecipe(r));

  if (valid2.length === 0) {
    return jsonNoStore({ ok: false, error: "Invalid recipes format (missing ingredients/steps)", raw: { t1, t2 } }, { status: 502 });
  }

  return jsonNoStore({ ok: true, recipes: valid2.slice(0, count) });
}

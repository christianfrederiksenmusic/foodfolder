import { NextResponse } from "next/server";

type ApiItem = { name?: string; confidence?: number; kind?: string; contents?: string };

type Body = {
  language?: string;
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

function clampText(s: any, max = 160): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max).trim() : t;
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

function normalizeItems(items: ApiItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const name = clampText(it?.name ?? "", 80);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!out.some((x) => x.toLowerCase() === key)) out.push(name);
  }
  return out.slice(0, 60);
}

function normalizePantry(pantry: unknown): string[] {
  const arr = Array.isArray(pantry) ? pantry : [];
  const out: string[] = [];
  for (const x of arr) {
    const v = clampText(x ?? "", 60);
    if (!v) continue;
    const key = v.toLowerCase();
    if (!out.some((y) => y.toLowerCase() === key)) out.push(v);
  }
  return out.slice(0, 80);
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
  return true;
}

function buildPrompt(args: { language: string; items: string[]; pantry: string[]; constraints: string; count: number }) {
  const { language, items, pantry, constraints, count } = args;

  const alwaysAllowed = ["water", "salt", "black pepper", "cooking oil"];
  const allowed = [...alwaysAllowed, ...pantry].filter(Boolean);

  return `You are a cooking assistant.

Return ONLY valid JSON. No markdown. No extra text.

Generate exactly ${count} complete recipes.

Hard rules:
- Each recipe MUST include:
  - title (string)
  - ingredients: >= 5 entries, each { "amount": string, "item": string }
  - steps: >= 5 concrete steps
- No duplicates.
- Use mostly fridge ingredients.
- You may add ONLY from this allowed pantry list: ${allowed.join(", ")}.
- Do NOT invent ingredients outside fridge + allowed pantry.
- Use metric units where possible (g, ml, tbsp, tsp).
- Language for all text: ${language}.

User constraints (optional):
${constraints ? clampText(constraints, 240) : "(none)"}

Fridge ingredients:
${items.map((x) => `- ${x}`).join("\n")}

Return JSON with shape:
{"recipes":[{"title":"...","summary":"...","servings":2,"time_minutes":20,"ingredients":[{"amount":"...","item":"..."}],"steps":["..."],"tags":["..."]}]}
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
      max_tokens: 1800,
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

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonNoStore({ ok: false, error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });

  let body: Body = {};
  try { body = (await req.json()) as Body; }
  catch { return jsonNoStore({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }

  const language = pickLang(body.language);
  const count = pickCount(body.count);
  const constraints = clampText(body.constraints ?? "", 400);

  const rawItems = Array.isArray(body.items) ? (body.items as any[]) : null;
  if (!rawItems) return jsonNoStore({ ok: false, error: "items must be an array" }, { status: 400 });

  const items = normalizeItems(rawItems as ApiItem[]);
  if (items.length === 0) return jsonNoStore({ ok: false, error: "No items provided" }, { status: 400 });

  const pantry = normalizePantry(body.pantry);
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  // Attempt 1
  const prompt1 = buildPrompt({ language, items, pantry, constraints, count });
  const a1 = await callAnthropic(apiKey, model, prompt1, 0.2);

  if (!a1.ok) {
    const apiError = a1.top?.error?.message || a1.top?.error || a1.top || a1.rawText;
    return jsonNoStore({ ok: false, error: `Anthropic error ${a1.status}`, raw: apiError }, { status: 502 });
  }

  const t1 = a1.top ? extractAssistantText(a1.top) : a1.rawText;
  const parsed1 = safeJsonParse(extractJsonObject(t1));
  const recipes1 = Array.isArray(parsed1?.recipes) ? parsed1.recipes : [];
  const valid1 = recipes1.filter(isValidRecipe);

  if (valid1.length > 0) return jsonNoStore({ ok: true, recipes: valid1.slice(0, count) });

  // Attempt 2: repair
  const prompt2 = `Fix the output to match the JSON shape strictly.
Rules: JSON only. recipes[].ingredients >= 5 with amount+item. recipes[].steps >= 5. Remove duplicates.
Do not invent ingredients outside:
- Fridge: ${items.join(", ")}
- Allowed pantry: ${["water","salt","black pepper","cooking oil", ...pantry].join(", ")}

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
  const valid2 = recipes2.filter(isValidRecipe);

  if (valid2.length === 0) {
    return jsonNoStore({ ok: false, error: "Invalid recipes format (missing ingredients/steps)", raw: { t1, t2 } }, { status: 502 });
  }

  return jsonNoStore({ ok: true, recipes: valid2.slice(0, count) });
}

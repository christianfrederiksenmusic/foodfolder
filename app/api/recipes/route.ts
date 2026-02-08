import { NextResponse } from "next/server";

type ApiItem = { name?: string; confidence?: number; kind?: string; contents?: string };

type Body = {
  // Language can come in many shapes from the UI
  language?: string;
  recipeLang?: string;
  recipeLanguage?: string;
  recipe_language?: string;
  targetLanguage?: string;
  uiLanguage?: string;
  lang?: string;

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

function clampText(s: any, max = 260): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max).trim() : t;
}

function normalizeItem(s: any): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function dedupeCaseInsensitive(list: string[], max = 140): string[] {
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

/**
 * Robust language normalization:
 * Accepts "da", "da-DK", "da_DK", "Danish", "Dansk" etc.
 */
function normalizeLangToken(raw: unknown): string {
  const s0 = typeof raw === "string" ? raw.trim() : "";
  if (!s0) return "";

  let s = s0.toLowerCase().trim().replace("_", "-");
  if (s.includes("-")) s = s.split("-")[0].trim();

  const map: Record<string, string> = {
    danish: "da",
    dansk: "da",
    norwegian: "no",
    norsk: "no",
    swedish: "sv",
    svenska: "sv",
    german: "de",
    deutsch: "de",
    english: "en",
    engelsk: "en",
    french: "fr",
    français: "fr",
    italian: "it",
    spanish: "es",
    portuguese: "pt",
    arabic: "ar",
  };
  if (map[s]) s = map[s];

  const allowed = new Set(["da","no","sv","de","en","fr","it","es","pt","ar"]);
  return allowed.has(s) ? s : "";
}

function pickLangFromBody(body: Body): string {
  // Try a bunch of possible keys in priority order
  const candidates = [
    body.language,
    body.recipeLang,
    body.recipeLanguage,
    body.recipe_language,
    body.targetLanguage,
    body.uiLanguage,
    body.lang,
  ];
  for (const c of candidates) {
    const norm = normalizeLangToken(c);
    if (norm) return norm;
  }
  return "en";
}

function langName(code: string): string {
  switch (code) {
    case "da": return "Danish";
    case "no": return "Norwegian";
    case "sv": return "Swedish";
    case "de": return "German";
    case "fr": return "French";
    case "it": return "Italian";
    case "es": return "Spanish";
    case "pt": return "Portuguese";
    case "ar": return "Arabic";
    default: return "English";
  }
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
  return dedupeCaseInsensitive(names, 90);
}

/**
 * Very light "is this output English?" heuristic.
 * Used only as a fallback to trigger a translate/repair pass when target != en.
 */
function looksEnglish(text: string): boolean {
  const t = (text || "").toLowerCase();
  // common English function words (low false positives if several hit)
  const hits = [" the ", " and ", " with ", " for ", " minutes", " cup", " tbsp", " tsp", " bake", " serve"];
  let score = 0;
  for (const h of hits) if (t.includes(h)) score++;
  return score >= 3;
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
      max_tokens: 2100,
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


/**
 * Deterministic consistency fix:
 * If recipe text mentions rice noodles, do not allow "rice/ris" as a substitute.
 */
function enforceNoodleConsistency(r: Recipe, language: string): Recipe {
  const title = String((r as any).title || "");
  const stepsArr = Array.isArray((r as any).steps) ? (r as any).steps : [];
  const summary = String((r as any).summary || "");
  const text = (title + "\n" + stepsArr.join("\n") + "\n" + summary).toLowerCase();
const wantsRiceNoodles =
    text.includes("risnudl") ||
    text.includes("rice noodle") ||
    text.includes("rice noodles");

  if (!wantsRiceNoodles) return r;

  const isNordic = language === "da" || language === "no" || language === "sv";
  const noodleWord = isNordic ? "risnudler" : "rice noodles";

  const fixItem = (item: string) => {
    const low = String(item || "").toLowerCase();

    // Already noodles: keep as-is
    if (low.includes("risnudl") || low.includes("rice noodle")) return item;

    // If it's clearly rice (not noodles), replace with noodles to keep the recipe coherent
    const trimmed = low.trim();
    if (trimmed === "ris" || trimmed === "rice") return noodleWord;
    if (trimmed.startsWith("ris ") || trimmed.startsWith("rice ")) return noodleWord;

    return item;
  };

  const ingredients = Array.isArray((r as any).ingredients)
    ? (r as any).ingredients.map((ing: any) => ({
        amount: String(ing?.amount || ""),
        item: fixItem(String(ing?.item || "")),
      }))
    : (r as any).ingredients;

  const missing_items = Array.isArray((r as any).missing_items)
    ? (r as any).missing_items.map((m: any) => fixItem(String(m || "")))
    : (r as any).missing_items;

  return { ...(r as any), ingredients, missing_items };
}

/**
 * Minimal title sanity gate: if title contains a suspicious token (likely hallucination),
 * we trigger a repair pass (handled in the main POST flow).
 */
function titleLooksSuspect(title: string): boolean {
  const t = (title || "").trim();
  if (!t) return true;
  // hard reject very short weird titles
  if (t.length < 6) return true;

  const lower = t.toLowerCase();
  // crude catch for "not-a-word" tokens like "rora" in Danish context
  // (kept minimal; we only trigger repair, we don't rewrite locally)
  const suspicious = ["rora"];
  for (const w of suspicious) {
    if (new RegExp(`\\b${w}\\b`, "i").test(lower)) return true;
  }
  return false;
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

function buildPrompt(args: {
  languageCode: string;
  languageName: string;
  fridge: string[];
  pantry: string[];
  constraints: string;
  count: number;
}) {
  const { languageCode, languageName, fridge, pantry, constraints, count } = args;

  // Keep prompt in English (models behave best), but FORCE output language explicitly.
  return `You are a cooking assistant.

Return ONLY valid JSON. No markdown. No extra text.

Generate exactly ${count} complete recipes.

Hard rules:
- Output language MUST be ${languageName} (code: ${languageCode}). ALL text fields must be in ${languageName}.
- Each recipe MUST include:
  - title (string)
  - ingredients: >= 5 entries, each { "amount": string, "item": string }
  - steps: >= 5 concrete steps
  - missing_items: array of strings (can be empty)
- CRITICAL CONSISTENCY RULE:
  If you mention an ingredient in the title, summary, or steps (including sauces/dressings),
  it MUST appear either in ingredients[] or in missing_items[].

User constraints (also in ${languageName} if present):
${constraints ? clampText(constraints, 420) : "(none)"}

Fridge ingredients (available):
${fridge.map((x) => `- ${x}`).join("\n")}

Pantry items (already have):
${pantry.map((x) => `- ${x}`).join("\n")}

Notes:
- Do NOT put water/tap water in missing_items.

Return JSON with shape:
{"recipes":[{"title":"...","summary":"...","servings":2,"time_minutes":20,"ingredients":[{"amount":"...","item":"..."}],"steps":["..."],"missing_items":["..."],"tags":["..."]}]}
`;
}

function buildTranslatePrompt(args: { languageName: string; jsonText: string }) {
  return `Translate ALL human-readable text fields in this JSON to ${args.languageName}.
Keep JSON structure identical.
Do not add/remove recipes or fields.
Translate: title, summary, ingredients[].item, steps[], tags[], missing_items[].
Keep amounts as-is (numbers/units), but translate unit words if present.
Return ONLY valid JSON.

JSON:
${args.jsonText}
`;
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

  const languageCode = pickLangFromBody(body);
  const languageName = langName(languageCode);
  const count = pickCount(body.count);
  const constraints = clampText(body.constraints ?? "", 600);

  const fridge = normalizeFridgeItems(body);
  if (fridge.length === 0) return jsonNoStore({ ok: false, error: "No fridge_items provided" }, { status: 400 });

  const pantry = normalizePantry(body);

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const prompt1 = buildPrompt({ languageCode, languageName, fridge, pantry, constraints, count });
  const a1 = await callAnthropic(apiKey, model, prompt1, 0.0);

  if (!a1.ok) {
    const apiError = a1.top?.error?.message || a1.top?.error || a1.top || a1.rawText;
    return jsonNoStore({ ok: false, error: `Anthropic error ${a1.status}`, raw: apiError }, { status: 502 });
  }

  const t1 = a1.top ? extractAssistantText(a1.top) : a1.rawText;
  const json1 = extractJsonObject(t1);
  const parsed1 = safeJsonParse(json1);
  const recipes1 = Array.isArray(parsed1?.recipes) ? parsed1.recipes : [];

  let valid: Recipe[] = recipes1.filter(isValidRecipe);

  // If target is NOT English and output looks English, force translate pass.
  if (languageCode !== "en" && looksEnglish(t1)) {
    const tp = buildTranslatePrompt({ languageName, jsonText: json1 });
    const aT = await callAnthropic(apiKey, model, tp, 0.0);

    if (aT.ok) {
      const tT = aT.top ? extractAssistantText(aT.top) : aT.rawText;
      const jsonT = extractJsonObject(tT);
      const parsedT = safeJsonParse(jsonT);
      const recipesT = Array.isArray(parsedT?.recipes) ? parsedT.recipes : [];
      const validT: Recipe[] = recipesT.filter(isValidRecipe);
      if (validT.length > 0) valid = validT;
    }
  }

  if (valid.length > 0) {
    return jsonNoStore({
      ok: true,
      language_received: {
        languageCode,
        languageName,
        // Help you debug what the UI actually sent without opening logs
        raw: {
          language: body.language,
          recipeLang: body.recipeLang,
          recipeLanguage: body.recipeLanguage,
          recipe_language: body.recipe_language,
          targetLanguage: body.targetLanguage,
          uiLanguage: body.uiLanguage,
          lang: body.lang,
        },
      },
      recipes: valid.slice(0, count).map((r) => enforceNoodleConsistency(r, languageCode)),
    });
  }

  // Repair pass (structure-only)
  const repairPrompt = `Fix the output to match the JSON shape strictly.
Rules: JSON only. recipes[].ingredients >= 5 with amount+item. recipes[].steps >= 5. recipes[].missing_items (array, can be empty). Remove duplicates.
Output language MUST be ${languageName} (code: ${languageCode}). ALL text fields must be in ${languageName}.
CRITICAL: Any ingredient mentioned in title/summary/steps MUST be listed in ingredients[] or missing_items[].
Do NOT list water/tap water in missing_items.

Broken output:
${t1 || "(empty)"}
`;

  const a2 = await callAnthropic(apiKey, model, repairPrompt, 0.0);

  if (!a2.ok) {
    const apiError = a2.top?.error?.message || a2.top?.error || a2.top || a2.rawText;
    return jsonNoStore({ ok: false, error: `Anthropic error ${a2.status}`, raw: apiError }, { status: 502 });
  }

  const t2 = a2.top ? extractAssistantText(a2.top) : a2.rawText;
  const parsed2 = safeJsonParse(extractJsonObject(t2));
  const recipes2 = Array.isArray(parsed2?.recipes) ? parsed2.recipes : [];
  const valid2: Recipe[] = recipes2.filter(isValidRecipe);

  if (valid2.length === 0) {
    return jsonNoStore({ ok: false, error: "Invalid recipes format after repair", raw: { t1, t2 } }, { status: 502 });
  }

  return jsonNoStore({
    ok: true,
    language_received: {
      languageCode,
      languageName,
      raw: {
        language: body.language,
        recipeLang: body.recipeLang,
        recipeLanguage: body.recipeLanguage,
        recipe_language: body.recipe_language,
        targetLanguage: body.targetLanguage,
        uiLanguage: body.uiLanguage,
        lang: body.lang,
      },
    },
    recipes: valid2.slice(0, count).map((r) => enforceNoodleConsistency(r, languageCode)),
  });
}

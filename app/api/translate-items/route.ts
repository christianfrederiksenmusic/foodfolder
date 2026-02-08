import { NextResponse } from "next/server";

type Body = {
  language?: string;
  items?: unknown;
};

function jsonNoStore(body: any, init?: { status?: number }) {
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  res.headers.set("cache-control", "no-store");
  return res;
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function stripCodeFences(raw: string): string {
  const t = raw.trim();
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
  if (t0.startsWith("{") && t0.endsWith("}")) return t0;

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

function clampText(s: string): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return t.length > 80 ? t.slice(0, 80).trim() : t;
}

function pickLang(x: unknown): string {
  const s = typeof x === "string" ? x.trim().toLowerCase() : "";
  const allowed = new Set(["da", "no", "sv", "de", "en", "fr", "it", "es", "pt", "ar"]);
  return allowed.has(s) ? s : "en";
}

const POST_FIX: Record<string, Record<string, string>> = {
  da: {
    burk: "krukke",
    "en burk": "en krukke",
    burken: "krukken"
  }
};

function applyPostFix(lang: string, text: string): string {
  const map = POST_FIX[lang];
  if (!map) return text;
  const key = text.trim().toLowerCase();
  return map[key] ?? text;
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
  const rawItems = Array.isArray(body.items) ? body.items : null;
  if (!rawItems) return jsonNoStore({ ok: false, error: "items must be an array" }, { status: 400 });

  const items = rawItems.slice(0, 80).map((x) => clampText(typeof x === "string" ? x : String(x ?? "")));

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["items"]
  } as const;

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const prompt =
`Translate grocery ingredient names.

Rules:
- Target language: ${language}
- Translate into everyday, native grocery terms in the target language.
- Keep brand names as-is.
- Keep units as-is.
- Do NOT add, remove, merge, split, or invent items.
- Output must have the same length and same order as input.
- Return JSON only, matching the provided JSON schema.

Input items:
${JSON.stringify(items)}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "structured-outputs-2025-11-13"
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      temperature: 0,
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }]
        }
      ]
    })
  });

  const raw = await anthropicRes.text();

  if (!anthropicRes.ok) {
    return jsonNoStore({ ok: false, error: `Anthropic error ${anthropicRes.status}`, raw }, { status: 502 });
  }

  const jsonTop = safeJsonParse(raw);
  if (!jsonTop) {
    return jsonNoStore({ ok: false, error: "Anthropic response was not JSON", raw }, { status: 502 });
  }

  const textBlocks: string[] =
    Array.isArray((jsonTop as any)?.content)
      ? (jsonTop as any).content
          .filter((b: any) => b?.type === "text" && typeof b?.text === "string")
          .map((b: any) => b.text)
      : [];

  const combined = textBlocks.join("\n").trim();
  const extracted = extractJsonObject(combined || "");
  const parsed = safeJsonParse(extracted);

  if (!parsed || !Array.isArray(parsed.items)) {
    return jsonNoStore({ ok: false, error: "Model did not return parseable JSON", raw: combined, top: jsonTop }, { status: 502 });
  }

  const out = parsed.items.slice(0, items.length).map((v: any, i: number) => {
    const t = clampText(typeof v === "string" ? v : String(v ?? items[i] ?? ""));
    return applyPostFix(language, t);
  });

  while (out.length < items.length) out.push(items[out.length]);

  return jsonNoStore({ ok: true, items: out });
}

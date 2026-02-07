import { NextResponse } from "next/server";

type Lang = "da" | "no" | "sv" | "de" | "en" | "fr" | "it" | "es" | "pt" | "ar";
const ALLOWED = new Set<Lang>(["da","no","sv","de","en","fr","it","es","pt","ar"]);

function labelFor(lang: Lang) {
  return {
    da: "Danish",
    no: "Norwegian",
    sv: "Swedish",
    de: "German",
    en: "English",
    fr: "French",
    it: "Italian",
    es: "Spanish",
    pt: "Portuguese",
    ar: "Arabic",
  }[lang];
}

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function extractFirstJsonObject(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return safeJsonParse(m[0]);
}

// små, konkrete fixes for kendte false friends
function postFix(lang: Lang, s: string) {
  let out = String(s ?? "").trim();

  if (lang === "da") {
    // sv "burk" -> da "krukke"
    out = out.replace(/\bburk\b/gi, "krukke");
    out = out.replace(/\bglas\s*krukke\b/gi, "glas-krukke");
    out = out.replace(/\bglas\s*burk\b/gi, "glas-krukke");
  }

  return out;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing ANTHROPIC_API_KEY", requestId }, { status: 500 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON", requestId }, { status: 400 });
  }

  const lang: Lang = ALLOWED.has(body?.language) ? body.language : "da";
  const items: string[] = Array.isArray(body?.items) ? body.items.map((x: any) => String(x ?? "")) : [];

  if (!items.length) {
    return NextResponse.json({ ok: false, error: "Missing items", requestId }, { status: 400 });
  }

  const targetLanguage = labelFor(lang);
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

  const prompt =
    "Translate the following grocery/ingredient names into " + targetLanguage + ".\n" +
    "Rules:\n" +
    "- Use native everyday grocery terms (avoid Swedish/Norwegian loanwords).\n" +
    "- Keep each item short (1-4 words), noun form.\n" +
    "- Return ONLY pure JSON: {\"items\":[...]}\n" +
    "Items: " + JSON.stringify(items);

  const anthropicBody = {
    model,
    max_tokens: 700,
    temperature: 0,
    messages: [
      { role: "user", content: [{ type: "text", text: prompt }] }
    ],
  };

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(anthropicBody),
  });

  const raw = await anthropicRes.text();
  if (!anthropicRes.ok) {
    return NextResponse.json(
      { ok: false, error: `Anthropic error ${anthropicRes.status}`, requestId, meta: { model }, raw },
      { status: 502 }
    );
  }

  const parsed = safeJsonParse(raw);
  const text = Array.isArray(parsed?.content)
    ? parsed.content.map((c: any) => (c?.type === "text" ? String(c?.text ?? "") : "")).join("\n")
    : "";

  const obj = extractFirstJsonObject(text);
  const out = Array.isArray(obj?.items) ? obj.items.map((x: any) => postFix(lang, x)) : null;

  if (!out || out.length !== items.length) {
    return NextResponse.json(
      { ok: false, error: "Translator did not return expected JSON", requestId, meta: { model }, raw },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, items: out, requestId });
}

import { NextResponse } from "next/server";



function extractJsonObject(raw: string): string {
  const t = (raw ?? "").trim();

  // Strip ```json ... ``` / ``` ... ```
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fence ? fence[1].trim() : t;

  // Take first {...} block if there's extra chatter
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return unfenced.slice(first, last + 1).trim();
  }
  return unfenced.trim();
}

function repairLikelyTruncatedJson(jsonish: string): string {
  let t = (jsonish ?? "").trim();

  // Remove trailing code fence artifacts (paranoia)
  t = t.replace(/```/g, "").trim();

  // If it already parses, great.
  try { JSON.parse(t); return t; } catch {}

  // Best-effort: handle common truncation in { "items": [ ... ]}
  const itemsIdx = t.indexOf('"items"');
  if (itemsIdx !== -1) {
    // If array started but didn't finish, cut to last complete object "}"
    const lastObj = t.lastIndexOf("}");
    if (lastObj !== -1) {
      const cut = t.slice(0, lastObj + 1);

      // If we have an opening [ after "items", ensure we close it + close root object.
      const hasItemsArray = cut.indexOf("[", itemsIdx) !== -1;
      if (hasItemsArray) {
        return cut + "] }";
      }
      return cut + " }";
    }
  }

  // Generic fallback: cut to last "}" and close root object
  const lastBrace = t.lastIndexOf("}");
  if (lastBrace !== -1) return t.slice(0, lastBrace + 1);

  return t;
}

function safeParseItems(raw: string): any {
  const extracted = extractJsonObject(raw);
  const repaired = repairLikelyTruncatedJson(extracted);
  return JSON.parse(repaired);
}


function extractJsonObject(raw: string): string {
  const t = (raw ?? "").trim();

  // 1) Strip ```json ... ``` / ``` ... ```
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fence ? fence[1].trim() : t;

  // 2) If there's extra chatter, take the first {...} block (best effort)
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return unfenced.slice(first, last + 1).trim();
  }

  return unfenced;
}


type Body = {
  image?: string;
  imageBase64?: string;
  imageDataUrl?: string;
  base64?: string;
  mode?: "thorough" | "conservative" | string;
};

// Simple safety-belt for v1. Note: In serverless, memory may reset between invocations.
// Still useful to prevent rapid accidental spam during development.
const MAX_REQUESTS_PER_IP_PER_DAY = 20;
const ipCounts: Map<string, { day: string; count: number }> = new Map();

function getUtcDayKey(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

function checkRateLimit(req: Request) {
  const ip = getClientIp(req);
  const today = getUtcDayKey();

  const entry = ipCounts.get(ip);
  if (!entry || entry.day !== today) {
    ipCounts.set(ip, { day: today, count: 1 });
    return { ok: true, ip, remaining: MAX_REQUESTS_PER_IP_PER_DAY - 1 };
  }

  if (entry.count >= MAX_REQUESTS_PER_IP_PER_DAY) {
    return { ok: false, ip, remaining: 0 };
  }

  entry.count += 1;
  ipCounts.set(ip, entry);
  return { ok: true, ip, remaining: MAX_REQUESTS_PER_IP_PER_DAY - entry.count };
}

function extractBase64DataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

function looksLikeBase64(s: string) {
  // permissive: allow newlines and url-safe variants
  const t = s.replace(/\s+/g, "");
  if (t.length < 32) return false;
  return /^[A-Za-z0-9+/_-]+=*$/.test(t);
}

function pickFirstString(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export async function POST(req: Request) {
  const rl = checkRateLimit(req);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit reached for today. Try again tomorrow." },
      { status: 429 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY on server." },
      { status: 500 }
    );
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected image payload." },
      { status: 400 }
    );
  }

  // Accept multiple possible fields from frontend
  const candidate = pickFirstString(
    body.image,
    body.imageBase64,
    body.imageDataUrl,
    body.base64
  );

  if (!candidate) {
    return NextResponse.json(
      { error: "Missing image. Upload an image and try again." },
      { status: 400 }
    );
  }

  // Determine whether candidate is a data URL or raw base64
  let mediaType = "image/jpeg";
  let base64 = "";

  if (candidate.startsWith("data:image/")) {
    const parsed = extractBase64DataUrl(candidate);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid image data URL format." },
        { status: 400 }
      );
    }
    mediaType = parsed.mediaType;
    base64 = parsed.base64;
  } else {
    // raw base64 path
    if (!looksLikeBase64(candidate)) {
      return NextResponse.json(
        { error: "Invalid image base64 data." },
        { status: 400 }
      );
    }
    base64 = candidate.replace(/\s+/g, "");
  }

  // prompt selected below (mode-aware)
const promptConservative = `
You are an expert at identifying food items from a fridge photo.

Return ONLY strict JSON with this schema:
{
  "items": [
    { "name": string, "confidence": number }
  ]
}

Rules:
- Use Danish names when possible.
- Only include items that are clearly visible.
- Avoid generic guesses like "olie", "eddike", "krydderier", "sauce", "syltetøj", "dressing" unless label is readable or packaging is unmistakable.
- If unsure, include with LOW confidence rather than inventing.
- Max 25 items.
`.trim();

  const promptThorough = `
You are an expert at identifying food items from a fridge photo.

Return ONLY strict JSON with this schema:
{
  "items": [
    { "name": string, "confidence": number }
  ]
}

Method (important):
- Scan systematically in zones: top shelf, middle shelf, bottom shelf, door shelves, drawers.
- Be exhaustive: list all visible food/ingredients even if you are not fully sure.
- If unsure, include the item with LOW confidence (0.35–0.60). Do not omit everything.

Rules:
- Use Danish names when possible.
- Avoid generic guesses like "olie", "eddike", "krydderier", "sauce", "syltetøj", "dressing" unless label is readable or packaging is unmistakable.
- confidence is 0.0–1.0 and must reflect evidence:
  - 0.90+ only if label is readable or unmistakable packaging
  - 0.70–0.89 strong visual evidence
  - 0.35–0.69 plausible but uncertain (still include)
- Max 50 items.
`.trim();

const mode = "thorough";
  const prompt = mode === "thorough" ? promptThorough : promptConservative;

  const payload = {
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1200,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64,
            },
          },
        ],
      },
    ],
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await resp.text();
    if (!resp.ok) {
      return NextResponse.json(
        { error: `Anthropic error ${resp.status}: ${raw}` },
        { status: 502 }
      );
    }

    const data = JSON.parse(extractJsonObject(raw)) as any;
    const text = data?.content?.find((c: any) => c?.type === "text")?.text;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "No text content returned from model." },
        { status: 502 }
      );
    }

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `Model did not return pure JSON. Got: ${text.slice(0, 500)}` },
        { status: 502 }
      );
    }

    const items = Array.isArray(parsedJson?.items) ? parsedJson.items : [];
    const bannedGeneric = new Set(["olie","eddike","krydderier","sauce","syltetøj","dressing"]);
    const cleanedItems = items
      .map((it: any) => ({
        name: String(it?.name ?? "").trim().toLowerCase(),
        confidence: typeof it?.confidence === "number" ? it.confidence : undefined,
      }))
      .filter((it: any) => it.name.length > 0)
      // keep generics only if fairly high confidence
      .filter((it: any) => !bannedGeneric.has(it.name) || (typeof it.confidence === "number" && it.confidence >= 0.85));
const ingredients = items
      .map((it: any) => String(it?.name ?? "").trim())
      .filter((s: string) => s.length > 0);

    return NextResponse.json({
      items: cleanedItems,
      ingredients,
      meta: {
        receivedImageBytesApprox: Math.round(base64.length * 0.75),
        model: payload.model,
        mode,
        rateLimitRemainingToday: rl.remaining,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}

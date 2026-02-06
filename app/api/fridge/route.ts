import { NextResponse } from "next/server";

type Body = { image?: string | null };

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
      { error: "Invalid JSON body. Expected { image: <base64 data url> }" },
      { status: 400 }
    );
  }

  if (
    !body.image ||
    typeof body.image !== "string" ||
    !body.image.startsWith("data:image/")
  ) {
    return NextResponse.json(
      { error: "Missing image. Upload an image and try again." },
      { status: 400 }
    );
  }

  const parsed = extractBase64DataUrl(body.image);
  if (!parsed) {
    return NextResponse.json(
      { error: "Invalid image data URL format." },
      { status: 400 }
    );
  }

  const prompt = `
You are an expert at identifying food items from a fridge photo.

Return ONLY strict JSON with this schema:
{
  "items": [
    { "name": string, "confidence": number }
  ]
}

Rules:
- Use Danish names when possible.
- confidence is 0.0 to 1.0.
- Include only food/ingredients (no brands, no containers).
- If unsure, include the item with low confidence rather than guessing confidently.
- Keep the list reasonably short (max 25).
`.trim();

  const payload = {
    model: "claude-3-haiku-20240307",
    max_tokens: 400,
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
              media_type: parsed.mediaType,
              data: parsed.base64,
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

    const data = JSON.parse(raw) as any;
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
    return NextResponse.json({
      items,
      meta: {
        receivedImageBytesApprox: Math.round(body.image.length * 0.75),
        model: payload.model,
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

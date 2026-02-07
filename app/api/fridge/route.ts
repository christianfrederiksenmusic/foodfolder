import { NextResponse } from "next/server";

type Body = {
  image?: string;
  imageBase64?: string;
  imageDataUrl?: string;
  base64?: string;
  mode?: string;
};

function pickFirstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function getUtcDayKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

const RATE_LIMIT_PER_IP_PER_UTC_DAY = 200;
const counters = new Map<string, number>();

function rateLimitOrThrow(req: Request) {
  const ip = getClientIp(req);
  const key = `${ip}:${getUtcDayKey()}`;
  const n = (counters.get(key) ?? 0) + 1;
  counters.set(key, n);
  if (n > RATE_LIMIT_PER_IP_PER_UTC_DAY) {
    const err = new Error("Rate limit exceeded");
    (err as any).status = 429;
    throw err;
  }
}

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const s = (dataUrl ?? "").trim();
  if (!s.startsWith("data:")) throw new Error("image skal være en dataURL (data:...)");
  const comma = s.indexOf(",");
  if (comma === -1) throw new Error("Ugyldig dataURL: mangler ','");
  const meta = s.slice(5, comma);
  const payload = s.slice(comma + 1);
  const parts = meta.split(";");
  const mediaType = (parts[0] || "application/octet-stream").trim();
  if (!parts.includes("base64")) throw new Error("Ugyldig dataURL: forventer ';base64'");
  if (!payload.trim()) throw new Error("Ugyldig dataURL: tom payload");
  return { mediaType, base64: payload.trim() };
}

function stripCodeFences(raw: string): string {
  const t = (raw ?? "").trim();
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

function normalizeItems(obj: any): Array<{ name: string; kind?: string; contents?: string; confidence?: number }> {
  const clean = (x: any) => String(x ?? "").trim();

  const arr =
    Array.isArray(obj?.items)
      ? obj.items
      : Array.isArray(obj?.ingredients)
        ? obj.ingredients.map((name: any) => ({ name, kind: "ingredient" }))
        : null;

  if (!arr) return [];

  const out: Array<{ name: string; kind?: string; contents?: string; confidence?: number }> = [];
  for (const it of arr) {
    if (typeof it === "string") {
      const name = clean(it);
      if (name) out.push({ name });
    } else if (it && typeof it === "object") {
      const name = clean(it.name);
      const kind = typeof it.kind === "string" ? clean(it.kind) : undefined;
      const contents = typeof it.contents === "string" ? clean(it.contents) : undefined;
      const c =
        typeof it.confidence === "number" && Number.isFinite(it.confidence) ? it.confidence : undefined;
      if (name) out.push({ name, kind, contents, confidence: c });
    }
  }
  return out;
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/fridge" });
}

export async function POST(req: Request) {
  try {
    rateLimitOrThrow(req);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
    }

    const body = (await req.json()) as Body;

    const candidate = pickFirstString(body.image, body.imageBase64, body.imageDataUrl, body.base64);
    if (!candidate) {
      return NextResponse.json({ ok: false, error: "Missing image (dataURL) in request body" }, { status: 400 });
    }

    const { mediaType, base64 } = parseDataUrl(candidate);

    const prompt = "Analysér hele scenen i billedet (ikke kun ingredienser). Returnér KUN JSON iht. schemaet. Inkludér både: (1) Ingredienser/madvarer, (2) Beholdere/emballage (gryde, boks, glas, flaske, bøtte, dåse, bakke, pose), og (3) hvis du kan se indholdet i en beholder, så angiv contents (fx \"glas\" + contents: \"syltetøj\"). Hvis indholdet ikke kan afgøres, skriv contents: \"ukendt\" og sæt lavere confidence. Ingen forklaring, ingen markdown, ingen ekstra tekst.";

    // Brug en moderne model (3.5 sonnet er retired)
    const model = "claude-sonnet-4-5";

    // Anthropic structured outputs: output_config.format.schema (IKKE json_schema)
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              kind: {
                type: "string",
                enum: ["ingredient", "container", "package", "drink", "unknown"]
              },
              contents: { type: "string" },
              confidence: { type: "number" }
            },
            required: ["name"]
          }
        }
      },
      required: ["items"]
    };

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Nogle miljøer kræver beta header for structured outputs
        "anthropic-beta": "structured-outputs-2025-11-13"
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        temperature: 0,
        output_config: {
          format: {
            type: "json_schema",
            schema
          }
        },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: prompt }
            ]
          }
        ]
      })
    });

    const raw = await anthropicRes.text();

    if (!anthropicRes.ok) {
      return NextResponse.json(
        { ok: false, error: `Anthropic error ${anthropicRes.status}`, raw },
        { status: anthropicRes.status }
      );
    }

    let jsonTop: any;
    try {
      jsonTop = JSON.parse(raw);
    } catch {
      const extracted = extractJsonObject(raw);
      try {
        const parsed = JSON.parse(extracted);
        return NextResponse.json({ ok: true, items: normalizeItems(parsed), raw: parsed });
      } catch {
        return NextResponse.json(
          { ok: false, error: "Anthropic response was not JSON", raw },
          { status: 502 }
        );
      }
    }

    const textBlocks: string[] = Array.isArray(jsonTop?.content)
      ? jsonTop.content.filter((b: any) => b?.type === "text" && typeof b?.text === "string").map((b: any) => b.text)
      : [];

    const combined = textBlocks.join("\n").trim();
    const extracted = extractJsonObject(combined || "");

    let parsed: any;
    try {
      parsed = JSON.parse(extracted);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Model did not return parseable JSON", raw: combined, top: jsonTop },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, items: normalizeItems(parsed), raw: parsed });
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status });
  }
}

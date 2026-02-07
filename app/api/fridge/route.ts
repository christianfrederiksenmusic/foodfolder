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

function genRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const RATE_LIMIT_PER_IP_PER_UTC_DAY = 200;
const BURST_LIMIT_PER_IP_PER_MINUTE = 30;

const dayCounters = new Map<string, number>();
const minuteCounters = new Map<string, { minuteKey: string; count: number }>();

function rateLimitOrThrow(req: Request) {
  const ip = getClientIp(req);
  const dayKey = `${ip}:${getUtcDayKey()}`;
  const nDay = (dayCounters.get(dayKey) ?? 0) + 1;
  dayCounters.set(dayKey, nDay);
  if (nDay > RATE_LIMIT_PER_IP_PER_UTC_DAY) {
    const err = new Error("Rate limit exceeded (per day)");
    (err as any).status = 429;
    (err as any).retry_after_seconds = 60 * 60;
    throw err;
  }

  const d = new Date();
  const minuteKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

  const mKey = `${ip}:${minuteKey}`;
  const cur = minuteCounters.get(mKey);
  const nMin = (cur?.count ?? 0) + 1;
  minuteCounters.set(mKey, { minuteKey, count: nMin });

  if (nMin > BURST_LIMIT_PER_IP_PER_MINUTE) {
    const err = new Error("Rate limit exceeded (per minute)");
    (err as any).status = 429;
    (err as any).retry_after_seconds = 60;
    throw err;
  }

  return { ip, dayCount: nDay, minuteCount: nMin };
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
      const c = typeof it.confidence === "number" && Number.isFinite(it.confidence) ? it.confidence : undefined;
      if (name) out.push({ name, kind, contents, confidence: c });
    }
  }
  return out;
}

function getVersion(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    "unknown"
  );
}

function jsonNoStore(body: any, init?: { status?: number }) {
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET() {
  return jsonNoStore({ ok: true, route: "/api/fridge", version: getVersion() });
}

export async function POST(req: Request) {
  const requestId = genRequestId();
  const started = Date.now();

  try {
    const rate = rateLimitOrThrow(req);
    const ua = req.headers.get("user-agent") || "unknown";
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return jsonNoStore({ ok: false, error: "Missing ANTHROPIC_API_KEY", requestId, version: getVersion() }, { status: 500 });
    }

    const bodyText = await req.text();
    const body = (safeJsonParse(bodyText) ?? {}) as Body;

    
    const languageRaw = typeof (body as any)?.language === "string" ? (body as any).language : "da";
    const allowedLangs = new Set(["da","no","sv","de","en","fr","it","es","pt","ar"]);
    const lang = (allowedLangs.has(languageRaw) ? languageRaw : "da") as "da"|"no"|"sv"|"de"|"en"|"fr"|"it"|"es"|"pt"|"ar";

    const langLabel: Record<typeof lang, string> = {
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
    };
    const targetLanguage = langLabel[lang] || "Danish";
const candidate = pickFirstString(body.image, body.imageBase64, body.imageDataUrl, body.base64);
    if (!candidate) {
      return jsonNoStore(
        { ok: false, error: "Missing image (dataURL) in request body", requestId, version: getVersion() },
        { status: 400 }
      );
    }

    const bytesIn = Buffer.byteLength(candidate, "utf8");
    const { mediaType, base64 } = parseDataUrl(candidate);
    const loanwordRule =
      lang === "da"
        ? "For Danish: use native Danish grocery words; avoid Swedish/Norwegian loanwords like 'burk'.\n"
        : "";

    const prompt =
      "Analyze the entire scene in the image (not only ingredients). Return ONLY JSON that matches the schema.\n"
      + "Include: (1) ingredients/groceries, (2) containers/packaging (pot, box, jar, bottle, tub, can, tray, bag), and (3) if you can see the contents of a container, fill `contents` (e.g. name: 'jar', contents: 'jam').\n"
      + "If contents cannot be determined, set contents: 'unknown' and lower confidence.\n"
      + "No explanations, no markdown, no extra text.\n"
      + "All text fields (name, contents) MUST be in " + targetLanguage + ".\n"
      + loanwordRule;
    const model = "claude-sonnet-4-5";

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
              kind: { type: "string", enum: ["ingredient", "container", "package", "drink", "unknown"] },
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
        "anthropic-beta": "structured-outputs-2025-11-13"
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        temperature: 0,
        output_config: { format: { type: "json_schema", schema } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: `Ingredient names MUST be in ${targetLanguage}.\n` + (prompt)}
            ]
          }
        ]
      })
    });

    const raw = await anthropicRes.text();

    const logLine = {
      at: "api.fridge",
      requestId,
      ip: rate.ip,
      ua,
      status: anthropicRes.status,
      ok: anthropicRes.ok,
      bytesIn,
      mediaType,
      model,
      ms: Date.now() - started
    };
    console.log(JSON.stringify(logLine));

    if (!anthropicRes.ok) {
      return jsonNoStore(
        {
          ok: false,
          error: `Anthropic error ${anthropicRes.status}`,
          requestId,
          version: getVersion(),
          meta: { model, bytesIn, rate },
          raw
        },
        { status: anthropicRes.status }
      );
    }

    const jsonTop = safeJsonParse(raw);
    if (!jsonTop) {
      return jsonNoStore(
        { ok: false, error: "Anthropic response was not JSON", requestId, version: getVersion(), meta: { model, bytesIn, rate }, raw },
        { status: 502 }
      );
    }

    const textBlocks: string[] = Array.isArray((jsonTop as any)?.content)
      ? (jsonTop as any).content
          .filter((b: any) => b?.type === "text" && typeof b?.text === "string")
          .map((b: any) => b.text)
      : [];

    const combined = textBlocks.join("\n").trim();
    const extracted = extractJsonObject(combined || "");
    const parsed = safeJsonParse(extracted);

    if (!parsed) {
      return jsonNoStore(
        { ok: false, error: "Model did not return parseable JSON", requestId, version: getVersion(), meta: { model, bytesIn, rate }, raw: combined, top: jsonTop },
        { status: 502 }
      );
    }

    const items = normalizeItems(parsed);

    return jsonNoStore({
      ok: true,
      items,
      requestId,
      version: getVersion(),
      meta: {
        model,
        bytesIn,
        rate
      }
    });
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    const retryAfter = typeof e?.retry_after_seconds === "number" ? e.retry_after_seconds : undefined;

    const body: any = { ok: false, error: e?.message ?? "Server error", requestId, version: getVersion() };
    if (retryAfter) body.retry_after_seconds = retryAfter;

    const res = jsonNoStore(body, { status });
    if (retryAfter) res.headers.set("retry-after", String(retryAfter));
    return res;
  }
}

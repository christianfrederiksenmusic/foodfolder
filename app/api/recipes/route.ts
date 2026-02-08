import { NextResponse } from "next/server";

type Body = {
  items?: Array<{
    name?: string;
    kind?: string;
    contents?: string;
    confidence?: number;
  }>;
  constraints?: string;
  count?: number;
};

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function getUtcDayKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
    d.getUTCDate(),
  ).padStart(
    2,
    "0",
  )}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

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

function genRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function jsonNoStore(body: any, init?: { status?: number }) {
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  res.headers.set("cache-control", "no-store");
  return res;
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

function getVersion(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    "unknown"
  );
}

export async function POST(req: Request) {
  const requestId = genRequestId();
  const started = Date.now();

  try {
    const rate = rateLimitOrThrow(req);
    const ua = req.headers.get("user-agent") || "unknown";
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return jsonNoStore(
        {
          ok: false,
          error: "Missing ANTHROPIC_API_KEY",
          requestId,
          sha: getVersion(),
        },
        { status: 500 },
      );
    }

    const bodyText = await req.text();
    const body = (safeJsonParse(bodyText) ?? {}) as Body;

    const items = Array.isArray(body.items) ? body.items : [];
    const names = items
      .map((x) => String(x?.name ?? "").trim())
      .filter((x) => x.length > 0);

    if (names.length === 0) {
      return jsonNoStore(
        { ok: false, error: "Missing items", requestId, sha: getVersion() },
        { status: 400 },
      );
    }

    const count =
      typeof body.count === "number" && Number.isFinite(body.count)
        ? Math.max(1, Math.min(6, Math.round(body.count)))
        : 4;
    const constraints =
      typeof body.constraints === "string" ? body.constraints.trim() : "";

    const model = "claude-sonnet-4-5";

const recipesSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          title: { type: "string" },
          ingredients: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } }
        }
      }
    }
  },
  required: ["recipes"]
} as const;


    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        recipes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              servings: { type: "number" },
              time_minutes: { type: "number" },
              ingredients: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    item: { type: "string" },
                    amount: { type: "string" },
                  },
                  required: ["item", "amount"],
                },
              },
              steps: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["title", "ingredients", "steps"],
          },
        },
      },
      required: ["recipes"],
    };

    const prompt =
      "Du er en køkkenassistent. Du får en liste af ingredienser/ting fra et køleskab. Returnér KUN JSON iht schema. " +
      "Lav opskrifter der bruger så mange af tingene som muligt. Hvis noget er uklart, lav realistiske antagelser men hold dem konservative. " +
      "Opskrifterne skal være konkrete og kunne laves i et almindeligt køkken. " +
      (constraints ? `Brugerens constraints: ${constraints}. ` : "") +
      `Returnér præcis ${count} opskrifter.`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "structured-outputs-2025-11-13",
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0.2,
        output_config: { format: { type: "json_schema", schema } },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "text", text: `Items: ${names.join(", ")}` },
            ],
          },
        ],
      }),
    });

    const raw = await anthropicRes.text();

    console.log(
      JSON.stringify({
        at: "api.recipes",
        requestId,
        ip: rate.ip,
        ua,
        status: anthropicRes.status,
        ok: anthropicRes.ok,
        itemsCount: names.length,
        model,
        ms: Date.now() - started,
      }),
    );

    if (!anthropicRes.ok) {
      return jsonNoStore(
        {
          ok: false,
          error: `Anthropic error ${anthropicRes.status}`,
          requestId,
          sha: getVersion(),
          meta: { model, rate },
          raw,
        },
        { status: anthropicRes.status },
      );
    }

    const jsonTop = safeJsonParse(raw);
    if (!jsonTop) {
      return jsonNoStore(
        {
          ok: false,
          error: "Anthropic response was not JSON",
          requestId,
          sha: getVersion(),
          raw,
        },
        { status: 502 },
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

    if (!parsed || !Array.isArray(parsed.recipes)) {
      return jsonNoStore(
        {
          ok: false,
          error: "Model did not return parseable recipes JSON",
          requestId,
          sha: getVersion(),
          raw: combined,
          top: jsonTop,
        },
        { status: 502 },
      );
    }

    return jsonNoStore({
      ok: true,
      recipes: parsed.recipes,
      requestId,
      sha: getVersion(),
      meta: { model, rate },
    });
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    const retryAfter =
      typeof e?.retry_after_seconds === "number"
        ? e.retry_after_seconds
        : undefined;

    const body: any = {
      ok: false,
      error: e?.message ?? "Server error",
      requestId,
      sha: getVersion(),
    };
    if (retryAfter) body.retry_after_seconds = retryAfter;

    const res = jsonNoStore(body, { status });
    if (retryAfter) res.headers.set("retry-after", String(retryAfter));
    return res;
  }
}

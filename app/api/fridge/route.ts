import { NextResponse } from "next/server";

export async function GET() {
  return Response.json(
    { ok: true, message: "Use POST to /api/fridge with { image: <dataURL> }" },
    { status: 200 }
  );
}



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




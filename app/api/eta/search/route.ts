import { NextResponse } from "next/server";
import { etaSearchOffers } from "@/lib/eta";

type ApiResponse = {
  q: string;
  cached: boolean;
  counts: { total: number; offers: number; promotions: number };
  offers: any[];
  promotions: any[];
};

type CacheEntry = { t: number; data: ApiResponse };
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCache(): Map<string, CacheEntry> {
  const g: any = globalThis as any;
  if (!g.__ETA_CACHE__) g.__ETA_CACHE__ = new Map();
  return g.__ETA_CACHE__ as Map<string, CacheEntry>;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.max(1, Math.min(80, parseInt(url.searchParams.get("limit") || "40", 10) || 40));
  const delayMs = Math.max(0, Math.min(1000, parseInt(url.searchParams.get("delayMs") || "120", 10) || 120));

  if (!q) {
    return NextResponse.json(
      { q: "", cached: false, counts: { total: 0, offers: 0, promotions: 0 }, offers: [], promotions: [] },
      { status: 200 }
    );
  }

  const cacheKey = `${q}::${limit}::${delayMs}`;
  const cache = getCache();
  const now = Date.now();
  const hit = cache.get(cacheKey);

  if (hit && now - hit.t < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, { status: 200 });
  }

  const all = await etaSearchOffers(q, { limit, delayMs });

  const offers = (all || []).filter((x: any) => x && x.price !== null);
  const promotions = (all || []).filter((x: any) => x && x.price === null);

  const payload: ApiResponse = {
    q,
    cached: false,
    counts: {
      total: (offers.length + promotions.length),
      offers: offers.length,
      promotions: promotions.length,
    },
    offers,
    promotions,
  };

  cache.set(cacheKey, { t: now, data: payload });
  return NextResponse.json(payload, { status: 200 });
}

import { NextResponse } from "next/server";
import { etaSearchOffers, type EtaOffer } from "@/lib/eta";

type StoreRow = {
  store: string;
  coverageCount: number;
  coveragePct: number;
  matchedItems: string[];
  sampleOffers: Array<{
    name: string | null;
    price: number | null;
    currency: string | null;
    validThrough: string | null;
    sourceUrl: string;
    image: string | null;
  }>;
  bestPrice: number | null;
};

type ApiResponse = {
  queries: string[];
  totalQueries: number;
  stores: StoreRow[];
};

function normalizeText(x: any): string {
  return String(x ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9æøå\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeQuery(q: string): string[] {
  const n = normalizeText(q);
  if (!n) return [];
  return n
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function offerMatchesQuery(offerName: string | null, query: string): boolean {
  const nameNorm = normalizeText(offerName || "");
  if (!nameNorm) return false;

  const toks = tokenizeQuery(query);
  if (toks.length === 0) return false;

  for (const t of toks) {
    if (
      nameNorm === t ||
      nameNorm.includes(` ${t} `) ||
      nameNorm.startsWith(`${t} `) ||
      nameNorm.endsWith(` ${t}`) ||
      nameNorm.includes(t)
    ) {
      return true;
    }
  }
  return false;
}

function uniqStrings(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs.map((s) => String(s || "").trim()).filter(Boolean)) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const qsParam = (url.searchParams.get("qs") || "").trim();
  const qParams = url.searchParams.getAll("q").map((x) => x.trim()).filter(Boolean);

  const queries = uniqStrings(
    qsParam ? qsParam.split(",").map((x) => x.trim()) : qParams
  ).slice(0, 10);

  if (queries.length === 0) {
    const empty: ApiResponse = { queries: [], totalQueries: 0, stores: [] };
    return NextResponse.json(empty, { status: 200 });
  }

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const all = await etaSearchOffers(q, { limit: 40, delayMs: 120 });
        return { q, offers: (all || []).filter((x) => x && x.price !== null) as EtaOffer[] };
      } catch {
        return { q, offers: [] as EtaOffer[] };
      }
    })
  );

  const storeMap = new Map<string, EtaOffer[]>();
  for (const r of results) {
    for (const o of r.offers) {
      const store = (o.store || "").trim();
      if (!store) continue;
      if (!storeMap.has(store)) storeMap.set(store, []);
      storeMap.get(store)!.push(o);
    }
  }

  const rows: StoreRow[] = [];
  for (const [store, offers] of storeMap.entries()) {
    const matched: string[] = [];

    for (const q of queries) {
      const ok = offers.some((o) => offerMatchesQuery(o.name, q));
      if (ok) matched.push(q);
    }

    let bestPrice: number | null = null;
    for (const o of offers) {
      // mild tie-break: any token match against concatenated queries
      if (!offerMatchesQuery(o.name, queries.join(" "))) continue;
      const p = o.price;
      if (typeof p === "number" && Number.isFinite(p)) {
        if (bestPrice === null || p < bestPrice) bestPrice = p;
      }
    }

    const sampleOffers = offers
      .filter((o) => o && o.sourceUrl && o.price !== null)
      .sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12))
      .slice(0, 4)
      .map((o) => ({
        name: o.name ?? null,
        price: o.price ?? null,
        currency: o.currency ?? "DKK",
        validThrough: o.validThrough ?? null,
        sourceUrl: o.sourceUrl,
        image: o.image ?? null,
      }));

    const coverageCount = matched.length;
    const coveragePct = queries.length ? Math.round((coverageCount / queries.length) * 100) : 0;

    rows.push({
      store,
      coverageCount,
      coveragePct,
      matchedItems: matched,
      sampleOffers,
      bestPrice,
    });
  }

  rows.sort((a, b) => {
    if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
    const ap = a.bestPrice ?? 1e12;
    const bp = b.bestPrice ?? 1e12;
    return ap - bp;
  });

  const payload: ApiResponse = {
    queries,
    totalQueries: queries.length,
    stores: rows.slice(0, 10),
  };

  return NextResponse.json(payload, { status: 200 });
}

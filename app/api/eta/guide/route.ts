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

function isAllowedStore(store: string | null): boolean {
  const s = normalizeText(store || "");

  const deny = ["fleggaard", "calle", "bordershop", "border shop", "helsam"];
  for (const d of deny) {
    if (s.includes(d)) return false;
  }

  const allow = [
    "føtex",
    "fotex",
    "bilka",
    "netto",
    "rema",
    "rema 1000",
    "lidl",
    "meny",
    "spar",
    "min købmand",
    "min kobmand",
    "superbrugsen",
    "kvickly",
    "brugsen",
    "dagli brugsen",
    "dagli'brugsen",
    "365discount",
    "365 discount",
    "coop",
    "abc lavpris",
    "løvbjerg",
    "lovbjerg",
    "nemlig",
    "nemlig com",
  ];

  for (const a of allow) {
    if (s.includes(normalizeText(a))) return true;
  }

  return false;
}

function isJunkOfferName(name: string | null): boolean {
  const n = normalizeText(name || "");
  if (!n) return false;

  const denySub = [
    "saftevand",
    "sodavand",
    "cola",
    "lemonade",
    "energidrik",
    "energy drink",
    "proteinbar",
    "protein bar",
    "müeslibar",
    "mueslibar",
    "snackbar",
    "slik",
    "chokolade",
    "chips",
    "kiks",
    "bolche",
    "vin",
    "øl",
    "spiritus",
    "cocktail",
  ];
  for (const d of denySub) {
    if (n.includes(normalizeText(d))) return true;
  }
  if (n.includes("juice") || n.includes("saft")) return true;
  return false;
}

function hasWholeWord(haystackNorm: string, needleNorm: string): boolean {
  if (!haystackNorm || !needleNorm) return false;
  const h = ` ${haystackNorm} `;
  const n = ` ${needleNorm} `;
  return h.includes(n);
}

function tokenizeQuery(q: string): string[] {
  const n = normalizeText(q);
  if (!n) return [];
  return n
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function isMilkQuery(qNorm: string): boolean {
  return qNorm === "mælk" || qNorm === "milk";
}

function milkMatch(nameNorm: string): boolean {
  // Reject flavored milk (including compounds like "kakaoskummetmælk")
  const denySub = ["kakao", "chokolade", "jordbær", "vanil", "protein", "shake"];
  if (nameNorm.includes("mælk")) {
    for (const d of denySub) {
      if (nameNorm.includes(d)) return false;
    }
  }

  const allowExact = new Set([
    "mælk",
    "letmælk",
    "minimælk",
    "skummetmælk",
    "skummemælk",
    "sødmælk",
    "kærnemælk",
  ]);

  const toks = nameNorm.split(" ").map((t) => t.trim()).filter(Boolean);
  for (const t of toks) {
    if (allowExact.has(t)) return true;
  }
  if (hasWholeWord(nameNorm, "mælk")) return true;
  return false;
}

function offerMatchesQuery(offerName: string | null, query: string): boolean {
  const nameNorm = normalizeText(offerName || "");
  const qNorm = normalizeText(query || "");
  if (!nameNorm || !qNorm) return false;

  if (isMilkQuery(qNorm)) return milkMatch(nameNorm);

  const toks = tokenizeQuery(qNorm).filter((t) => t.length >= 3);
  if (toks.length === 0) return false;

  for (const t of toks) {
    if (hasWholeWord(nameNorm, t)) return true;
  }
  return false;
}

function expandQuery(q: string): string[] {
  const qNorm = normalizeText(q);
  if (!qNorm) return [];
  if (qNorm === "mælk" || qNorm === "milk") {
    return uniqStrings([
      "mælk",
      "skummetmælk",
      "skummemælk",
      "letmælk",
      "sødmælk",
      "minimælk",
      "kærnemælk",
      "økologisk mælk",
    ]);
  }
  if (qNorm.includes("lime") && (qNorm.includes("juice") || qNorm.includes("saft"))) {
    return ["lime", "limes", "limefrugt"];
  }
  return [q];
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const qsParam = (url.searchParams.get("qs") || "").trim();
  const qParams = url.searchParams.getAll("q").map((x) => x.trim()).filter(Boolean);

  const queries = uniqStrings(qsParam ? qsParam.split(",").map((x) => x.trim()) : qParams).slice(0, 10);

  if (queries.length === 0) {
    const empty: ApiResponse = { queries: [], totalQueries: 0, stores: [] };
    return NextResponse.json(empty, { status: 200 });
  }

  const results = await Promise.all(
    queries.map(async (q) => {
      const expanded = expandQuery(q);
      const merged: EtaOffer[] = [];
      const seen = new Set<string>();

      // parallel per query too (small fanout)
      const fetched = await Promise.all(
        expanded.map(async (eq) => {
          try {
            const all = await etaSearchOffers(eq, { limit: 40, delayMs: 60 });
            return (all || []) as EtaOffer[];
          } catch {
            return [] as EtaOffer[];
          }
        })
      );

      for (const arr of fetched) {
        for (const o of arr) {
          if (!o || o.price === null) continue;
          if (!isAllowedStore(o.store || null)) continue;
          if (isJunkOfferName(o.name || null)) continue;

          const key = (o.sourceUrl || "").trim();
          if (!key) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(o);
        }
      }

      return { q, offers: merged };
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
      const anyOk = queries.some((q) => offerMatchesQuery(o.name, q));
      if (!anyOk) continue;
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

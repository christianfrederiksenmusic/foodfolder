"use client";

import { useEffect, useMemo, useState } from "react";

type EtaOffer = {/* unitPrice hidden */};

type ApiResponse = {
  q: string;
  cached: boolean;
  counts: { total: number; offers: number; promotions: number };
  offers: any[];
  promotions: any[];
};

function formatDkk(price: number | null) {
  if (price === null || price === undefined) return "";
  return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(price);
}

function isoToDaDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("da-DK");
}

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
  // Drop very short tokens (noise)
  return n.split(" ").map((t) => t.trim()).filter((t) => t.length >= 3);
}

function isValidHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u || "");
}

const BLACKLIST_SUBSTRINGS = [
  // "boxes / storage noise"
  "box",
  "opbevaringsboks",
  "opbevaring",
  "kasse",
  "container",
  // pet food noise
  "hund",
  "hunde",
  "dog",
  "kat",
  "cat",
  "foder",
  // common brand campaign noise we saw
  "knorr",
];

function looksLikeNoiseName(nameNorm: string): boolean {
  if (!nameNorm) return true;
  for (const bad of BLACKLIST_SUBSTRINGS) {
    if (nameNorm.includes(bad)) return true;
  }
  return false;
}

function matchesAnyQuery(offerName: string, queries: string[]): boolean {
  const nameNorm = normalizeText(offerName);
  if (!nameNorm) return false;

  // For each query, require at least 1 meaningful token to appear in the name
  for (const q of queries) {
    const toks = tokenizeQuery(q);
    if (toks.length === 0) continue;

    let hit = 0;
    for (const t of toks) {
      // crude word-ish boundary: spaces around token after normalization
      if (nameNorm === t || nameNorm.includes(` ${t} `) || nameNorm.startsWith(`${t} `) || nameNorm.endsWith(` ${t}`) || nameNorm.includes(t)) {
        hit++;
        break;
      }
    }
    if (hit > 0) return true;
  }
  return false;
}

export default function OffersPanel(props: {
  queries: string[];
  limitPerQuery?: number;
}) {
  const queries = useMemo(
    () => (props.queries || []).map((s) => s.trim()).filter(Boolean).slice(0, 6),
    [props.queries]
  );

  const limitPerQuery = props.limitPerQuery ?? 40;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [offers, setOffers] = useState<EtaOffer[]>([]);
  const [promotions, setPromotions] = useState<EtaOffer[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (queries.length === 0) {
        setOffers([]);
        setPromotions([]);
        return;
      }

      setLoading(true);
      setErr(null);

      try {
        const results = await Promise.all(
          queries.map(async (q) => {
            const res = await fetch(
              `/api/eta/search?q=${encodeURIComponent(q)}&limit=${limitPerQuery}&delayMs=120`,
              { cache: "no-store" }
            );
            if (!res.ok) throw new Error(`API ${res.status} for q=${q}`);
            return (await res.json()) as ApiResponse;
          })
        );

        if (cancelled) return;

        const byUrl = new Map<string, any>();
        const promos: any[] = [];

        for (const r of results) {
          for (const o of r.offers || []) {
                        const key = (o as any)?.sourceUrl || (o as any)?.source_url || (o as any)?.url || (o as any)?.offerUrl || (o as any)?.publicId || (o as any)?.offerId;
            if (!o || !key) continue;
            if (!byUrl.has(key)) byUrl.set(key, o);
}
          for (const p of r.promotions || []) promos.push(p);
        }

        // Hard filters: must have price+store+name+valid url and be query-relevant
        const mergedOffers = Array.from(byUrl.values())
          .filter((o) => {
            const name = (o as any).name || "";
            const store = (o as any).store || "";
            const url = (o as any).sourceUrl || "";
            const price = (o as any).price;

            if (!name || !store) return false;
            if (!isValidHttpUrl(url)) return false;
            if (price === null || price === undefined) return false;
            if (!Number.isFinite(price)) return false;
            if (price <= 0 || price > 100000) return false;

            const nameNorm = normalizeText(name);
            if (looksLikeNoiseName(nameNorm)) return false;
            if (!matchesAnyQuery(name, queries)) return false;

            return true;
          })
          .sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12));

        // Promotions: keep them, but cap and avoid pure noise
        const mergedPromos = promos
          .filter((p) => p && p.price === null && !!(p as any).sourceUrl && isValidHttpUrl((p as any).sourceUrl))
          .filter((p) => {
            const nameNorm = normalizeText((p as any).name || "");
            if (!nameNorm) return false;
            if (looksLikeNoiseName(nameNorm)) return false;
            return matchesAnyQuery((p as any).name || "", queries);
          })
          .slice(0, 20);

        console.log("[OffersPanel] queries=", queries, "offers=", mergedOffers.length, "promos=", mergedPromos.length);
        setOffers(mergedOffers);
        setPromotions(mergedPromos);
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message || String(e));
        setOffers([]);
        setPromotions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [queries, limitPerQuery]);

  return (
    <section className="mt-4 w-full rounded-2xl border border-black/10 bg-white/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tilbud</h2>
          <p className="text-sm opacity-70">
            {queries.length ? `Søgning: ${queries.join(", ")}` : "Ingen søgning endnu"}
          </p>
        </div>
        <div className="text-sm opacity-70">{loading ? "Henter..." : `${offers.length} tilbud`}</div>
      </div>

      {err && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm">Fejl: {err}</div>
      )}

      {!err && !loading && offers.length === 0 && (
        <div className="mt-3 rounded-xl border border-black/10 bg-white p-3 text-sm opacity-80">
          Ingen tilbud fundet (eller alt blev filtreret fra som støj/irrelevant).
        </div>
      )}

      
      <div className="mt-3 space-y-2">
        {offers.slice(0, 30).map((o) => {
          const key =
            ((o as any).sourceUrl || (o as any).source_url || (o as any).url || (o as any).offerUrl || (o as any).publicId || (o as any).offerId || (o as any).name || Math.random().toString(36));

          const href =
            ((o as any).sourceUrl || (o as any).source_url || (o as any).url || (o as any).offerUrl || "");

          return (
            <a
              key={key}
              href={href || undefined}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <div className="flex gap-3 p-3 rounded-xl border border-black/10 bg-white hover:bg-slate-50">
                <div className="w-16 h-16 rounded-xl overflow-hidden border border-black/10 flex-shrink-0 bg-slate-50">
                  {(o as any).image ? (
                    <img
                      src={(o as any).image}
                      alt={(o as any).name || "Tilbud"}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 leading-snug break-words">
                        {(o as any).name || "Tilbud"}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-600 break-words">
                        {(o as any).store || "Ukendt butik"}
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="text-base font-semibold">
                        {formatDkk((o as any).price)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
      

      {promotions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold opacity-80">Kampagner uden fast pris</h3>
          <ul className="mt-2 space-y-2">
            {promotions.slice(0, 10).map((p) => (
              <li key={((p as any).sourceUrl || (p as any).url || (p as any).publicId || (p as any).offerId || (p as any).name || Math.random().toString(36))} className="rounded-xl border border-black/10 bg-white p-3 text-sm">
                <a href={((p as any).sourceUrl || (p as any).url || "")} target="_blank" rel="noreferrer" className="underline">
                  {(p as any).name}
                </a>
                {(p as any).discountPercent ? <span className="ml-2 opacity-70">({(p as any).discountPercent}%)</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

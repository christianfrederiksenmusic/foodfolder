"use client";

import { useEffect, useMemo, useState } from "react";

type EtaOffer = {
  sourceUrl: string;
  store: string | null;
  name: string | null;
  price: number | null; // DKK
  currency: string | null;
  unitPrice: number | null;
  unitPriceUnit: string | null;
  validFrom: string | null;
  validThrough: string | null;
  image: string | null;
  kind: "offer" | "promotion";
  discountPercent: number | null;
};

type ApiResponse = {
  q: string;
  cached: boolean;
  counts: { total: number; offers: number; promotions: number };
  offers: EtaOffer[];
  promotions: EtaOffer[];
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

        const byUrl = new Map<string, EtaOffer>();
        const promos: EtaOffer[] = [];

        for (const r of results) {
          for (const o of r.offers || []) {
            if (!byUrl.has(o.sourceUrl)) byUrl.set(o.sourceUrl, o);
          }
          for (const p of r.promotions || []) promos.push(p);
        }

        const mergedOffers = Array.from(byUrl.values())
          .filter((o) => o.price !== null)
          .sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12));

        const mergedPromos = promos.filter((p) => p.price === null).slice(0, 20);

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
          Ingen tilbud fundet (eller ingen priser i resultaterne).
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {offers.slice(0, 30).map((o) => (
          <a
            key={o.sourceUrl}
            href={o.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex gap-3 rounded-2xl border border-black/10 bg-white p-3 hover:border-black/20"
          >
            {o.image ? (
              <img src={o.image} alt={o.name || "Tilbud"} className="h-16 w-16 rounded-xl object-cover" />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-black/5" />
            )}

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{o.name || "Ukendt vare"}</div>
              <div className="mt-1 flex items-center gap-2 text-xs opacity-70">
                <span className="truncate">{o.store || "Ukendt butik"}</span>
                {o.validThrough && (
                  <span className="shrink-0">til {isoToDaDate(o.validThrough) || o.validThrough}</span>
                )}
              </div>

              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="text-base font-semibold">{formatDkk(o.price)}</div>
                {o.unitPrice !== null && (
                  <div className="text-xs opacity-70">
                    {formatDkk(o.unitPrice)}
                    {o.unitPriceUnit ? ` / ${o.unitPriceUnit}` : ""}
                  </div>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>

      {promotions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold opacity-80">Kampagner uden fast pris</h3>
          <ul className="mt-2 space-y-2">
            {promotions.slice(0, 10).map((p) => (
              <li key={p.sourceUrl} className="rounded-xl border border-black/10 bg-white p-3 text-sm">
                <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                  {p.name}
                </a>
                {p.discountPercent ? <span className="ml-2 opacity-70">({p.discountPercent}%)</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

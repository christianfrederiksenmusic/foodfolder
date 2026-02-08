"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function StoreGuidePanel(props: { queries: string[] }) {
  const queries = useMemo(
    () => (props.queries || []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
    [props.queries]
  );

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (queries.length === 0) {
        setData(null);
        setErr(null);
        return;
      }

      setLoading(true);
      setErr(null);

      try {
        const qs = encodeURIComponent(queries.join(","));
        const res = await fetch(`/api/eta/guide?qs=${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setData(json);
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message || String(e));
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [queries]);

  const stores = data?.stores || [];
  const top3 = stores.slice(0, 3);

  return (
    <section className="mt-4 w-full rounded-2xl border border-black/10 bg-white/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Butiks-guidning</h2>
          <p className="text-sm opacity-70">
            {queries.length ? `Coverage på: ${queries.join(", ")}` : "Ingen mangler endnu"}
          </p>
        </div>
        <div className="text-sm opacity-70">{loading ? "Beregner..." : `${top3.length} butikker`}</div>
      </div>

      {err && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm">Fejl: {err}</div>
      )}

      {!err && !loading && queries.length > 0 && top3.length === 0 && (
        <div className="mt-3 rounded-xl border border-black/10 bg-white p-3 text-sm opacity-80">
          Ingen butikker kunne scores (ingen tilbud matchede dine mangler).
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {top3.map((s) => (
          <div key={s.store} className="rounded-2xl border border-black/10 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{s.store}</div>
                <div className="mt-1 text-xs opacity-70">
                  Coverage: {s.coverageCount}/{queries.length} ({s.coveragePct}%)
                </div>
              </div>
              {typeof s.bestPrice === "number" ? (
                <div className="shrink-0 rounded-xl bg-black/5 px-2 py-1 text-xs font-semibold">
                  {formatDkk(s.bestPrice)}
                </div>
              ) : null}
            </div>

            {s.matchedItems?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.matchedItems.slice(0, 8).map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-black/10 bg-white px-2 py-1 text-xs opacity-80"
                  >
                    {m}
                  </span>
                ))}
              </div>
            ) : null}

            {s.sampleOffers?.length ? (
              <div className="mt-3 space-y-2">
                {s.sampleOffers.slice(0, 3).map((o) => (
                  <a
                    key={o.sourceUrl}
                    href={o.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-xl border border-black/10 bg-white p-2 hover:border-black/20"
                  >
                    {o.image ? (
                      <img src={o.image} alt={o.name || "Tilbud"} className="h-10 w-10 rounded-lg object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-black/5" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold">{o.name || "Ukendt vare"}</div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] opacity-70">
                        <span>{formatDkk(o.price)}</span>
                        {o.validThrough ? <span>til {isoToDaDate(o.validThrough) || o.validThrough}</span> : null}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

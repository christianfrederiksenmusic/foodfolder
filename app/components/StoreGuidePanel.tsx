"use client";

import { useEffect, useMemo, useState } from "react";
import { Lang, t } from "../i18n";

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

function parseOfferPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;

  // handle "12,95", "12.95", "kr 12,95", etc.
  const m = s.replace(/\s+/g, "").match(/(\d+[\.,]?\d{0,2})/);
  if (!m) return null;
  const num = Number(m[1].replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

export default function StoreGuidePanel(props: {
  queries: string[];
  displayQueries?: string[];
  lang: Lang;
  selectedOffers?: any[];
}) {
  const fmt = (s: string, vars: Record<string, string>) =>
    s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));

  const selectedOffers = useMemo(
    () => (props.selectedOffers || []).filter(Boolean),
    [props.selectedOffers]
  );

  const hasSelectedOffers = selectedOffers.length > 0;

  const cartQueries = useMemo(
    () =>
      Array.from(
        new Set(
          selectedOffers
            .map((o: any) =>
              (
                o?.name ??
                o?.title ??
                o?.productName ??
                o?.itemName ??
                ""
              )
                .toString()
                .trim()
            )
            .filter(Boolean)
        )
      ).slice(0, 10),
    [selectedOffers]
  );

  const queries = useMemo(
    () =>
      hasSelectedOffers
        ? cartQueries
        : (props.queries || []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
    [hasSelectedOffers, cartQueries, props.queries]
  );

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const localData = useMemo<ApiResponse | null>(() => {
    if (!hasSelectedOffers) return null;

    const grouped = new Map<string, any[]>();

    for (const o of selectedOffers) {
      const storeName =
        (
          o?.storeName ??
          o?.retailer ??
          o?.shop ??
          o?.chain ??
          o?.store ??
          (props.lang === "da" ? "Ukendt butik" : "Unknown store")
        )
          ?.toString()
          .trim() || (props.lang === "da" ? "Ukendt butik" : "Unknown store");

      if (!grouped.has(storeName)) grouped.set(storeName, []);
      grouped.get(storeName)!.push(o);
    }

    const totalQueries = Math.max(queries.length, 1);

    const stores: StoreRow[] = Array.from(grouped.entries())
      .map(([store, items]) => {
        const sampleOffers = items.map((o: any) => {
          const priceVal =
            parseOfferPrice(
              o?.price ??
                o?.currentPrice ??
                o?.offerPrice ??
                o?.salePrice ??
                o?.priceText ??
                o?.priceLabel ??
                o?.currentPriceText
            );

          const name =
            (
              o?.name ??
              o?.title ??
              o?.productName ??
              o?.itemName ??
              (props.lang === "da" ? "Ukendt vare" : "Unknown item")
            )
              ?.toString()
              .trim() || (props.lang === "da" ? "Ukendt vare" : "Unknown item");

          const sourceUrl =
            (
              o?.sourceUrl ??
              o?.url ??
              o?.href ??
              ""
            )
              ?.toString()
              .trim() || "";

          const validThrough =
            (
              o?.validThrough ??
              o?.expiresAt ??
              o?.endDate ??
              o?.until ??
              null
            ) as string | null;

          const image =
            (
              o?.image ??
              o?.imageUrl ??
              o?.img ??
              o?.thumbnail ??
              null
            ) as string | null;

          return {
            name,
            price: priceVal,
            currency: "DKK",
            validThrough,
            sourceUrl,
            image,
          };
        });

        const matchedItems = Array.from(
          new Set(
            sampleOffers
              .map((x) => (x.name || "").trim())
              .filter(Boolean)
          )
        );

        const numericPrices = sampleOffers
          .map((x) => x.price)
          .filter((x): x is number => typeof x === "number" && Number.isFinite(x));

        const bestPrice = numericPrices.length ? Math.min(...numericPrices) : null;
        const coverageCount = matchedItems.length;
        const coveragePct = Math.round((coverageCount / totalQueries) * 100);

        return {
          store,
          coverageCount,
          coveragePct,
          matchedItems,
          sampleOffers,
          bestPrice,
        };
      })
      .sort((a, b) => {
        if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
        if (a.bestPrice === null && b.bestPrice === null) return 0;
        if (a.bestPrice === null) return 1;
        if (b.bestPrice === null) return -1;
        return a.bestPrice - b.bestPrice;
      });

    return {
      queries,
      totalQueries: queries.length,
      stores,
    };
  }, [hasSelectedOffers, selectedOffers, queries, props.lang]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (hasSelectedOffers) {
        setLoading(false);
        setErr(null);
        setData(null);
        return;
      }

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
  }, [hasSelectedOffers, queries.join("|")]);

  const stores = (hasSelectedOffers ? localData?.stores : data?.stores) || [];
  const top3 = stores.slice(0, 3);

  return (
    <section className="w-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t(props.lang, "store_guide_title")}</h2>
        </div>
        <div className="text-sm opacity-70">{loading ? t(props.lang, "store_guide_loading") : fmt(t(props.lang, "store_guide_count"), { n: String(top3.length)  })}</div>
      </div>

      {err && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm">{fmt(t(props.lang, "store_guide_error_prefix"), { err })}</div>
      )}

      {!err && !loading && queries.length > 0 && top3.length === 0 && (
        <div className="mt-3 rounded-xl border border-black/10 bg-white p-3 text-sm opacity-80">
          {t(props.lang, "store_guide_none_scored")}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {top3.map((s) => (
          <div key={s.store} className="rounded-2xl border border-black/10 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{s.store}</div>
                <div className="mt-1 text-xs opacity-70">
                  {props.lang === "da" ? `Du kan få ${s.coverageCount} af ${Math.max(queries.length, 1)} varer her` : `You can get ${s.coverageCount} of ${Math.max(queries.length, 1)} items here`}
                </div>
              </div>
              {typeof s.bestPrice === "number" ? (
                <div className="shrink-0 rounded-xl bg-black/5 px-2 py-1 text-xs font-semibold">
                  {formatDkk(s.bestPrice)}
                </div>
              ) : null}
            </div>

            {s.sampleOffers?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {s.sampleOffers
                  .filter((o) => !!o.image)
                  .slice(0, 6)
                  .map((o, idx) => (
                    <a
                      key={`${o.sourceUrl || "offer"}-${idx}`}
                      href={o.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                      title={o.name || undefined}
                    >
                      <img
                        src={o.image as any}
                        alt={o.name || "Tilbud"}
                        className="h-12 w-12 rounded-xl object-cover border border-black/10 hover:border-black/20"
                        loading="lazy"
                      />
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

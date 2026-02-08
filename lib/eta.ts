import { decode as htmlDecode } from "html-entities";

export type EtaOffer = {
  sourceUrl: string;
  store: string | null;
  publication: string | null;
  offerId: string | null;
  publicId: string | null;
  name: string | null;
  price: number | null; // DKK (float)
  currency: string | null;
  unitPrice: number | null;
  unitPriceUnit: string | null;
  validFrom: string | null;
  validThrough: string | null;
  image: string | null;
  kind: "offer" | "promotion";
  discountPercent: number | null;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toFloat(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const s = x.trim().replace(",", ".");
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function pick(obj: any, path: string[]): any {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return cur ?? null;
}

function parseDiscountPercent(name: string | null): number | null {
  if (!name) return null;
  const m = name.match(/(\d{1,3})\s*%/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  if (v > 0 && v <= 100) return v;
  return null;
}

export function extractOfferUrlsFromSearchHtml(html: string): string[] {
  
  // Robust extractor:
  // 1) JSON-LD (SearchResultsPage) itemListElement URLs
  // 2) Fallback regex for any URL containing ?publication=...&offer=...
  // Also handles relative URLs and &amp; encoding.
  const out: string[] = [];
  const seen = new Set<string>();

  const pushUrl = (u: string) => {
    if (!u) return;
    let url = String(u).trim();

    // decode HTML entities we care about
    url = url.replace(/&amp;/g, "&");

    // handle relative URLs
    if (url.startsWith("/")) url = "https://etilbudsavis.dk" + url;

    // ensure it's on-domain and has required params
    if (!url.startsWith("https://etilbudsavis.dk/")) return;
    if (!url.includes("?publication=")) return;
    if (!url.includes("&offer=") && !url.includes("offer=")) return;

    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  };

  // 1) JSON-LD blocks
  try {
    const ldBlocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
      .map(m => (m[1] || "").trim())
      .filter(Boolean);

    for (const block of ldBlocks) {
      // Some pages embed multiple JSON objects/arrays; try parse as-is, else skip
      let data: any = null;
      try {
        data = JSON.parse(block);
      } catch {
        continue;
      }

      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const items = node?.itemListElement;
        if (!Array.isArray(items)) continue;

        for (const it of items) {
          // JSON-LD can express URL in several ways:
          // item.url, item.@id, url, @id
          const u =
            it?.item?.url ||
            it?.item?.["@id"] ||
            it?.url ||
            it?.["@id"];

          if (typeof u === "string") pushUrl(u);
        }
      }
    }
  } catch {
    // ignore; fallback regex below will still work
  }

  // 2) Fallback: any href containing publication+offer
  try {
    for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
      const href = m[1] || "";
      if (href.includes("publication=") && href.includes("offer=")) pushUrl(href);
    }
  } catch {}

  // 3) Fallback fallback: raw URL-ish strings (handles cases without href quoting)
  try {
    for (const m of html.matchAll(/(https?:\/\/etilbudsavis\.dk\/[^\s"'<>]+publication=[^"'<>]+offer=[^"'<>]+)/gi)) {
      pushUrl(m[1] || "");
    }
    for (const m of html.matchAll(/(\/[^\s"'<>]+\?[^"'<>]*publication=[^"'<>]+offer=[^"'<>]+)/gi)) {
      pushUrl(m[1] || "");
    }
  } catch {}

  return out;

}

export function extractOfferAppDataPayloadFromOfferHtml(html: string): any | null {
  // Parse <app-data ...>INNER</app-data> and find the one whose decoded key begins with ["offer",
  // data-key is base64 of the query key; inner is HTML-escaped JSON
  const appRe = /<app-data\b([^>]*)>([\s\S]*?)<\/app-data>/gi;
  const attrRe = /data-key="([^"]+)"/i;

  for (let m; (m = appRe.exec(html)); ) {
    const attrs = m[1] || "";
    const innerRaw = (m[2] || "").trim();
    const am = attrs.match(attrRe);
    if (!am) continue;

    const dataKey = am[1];
    // base64 decode dataKey
    let decodedKey = "";
    try {
      const normalized = dataKey.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((dataKey.length + 3) % 4);
      decodedKey = Buffer.from(normalized, "base64").toString("utf8");
    } catch {
      continue;
    }

    if (!decodedKey.startsWith('["offer",')) continue;
    if (!innerRaw) continue;

    const unescaped = htmlDecode(innerRaw).trim();
    try {
      return JSON.parse(unescaped);
    } catch {
      // if parsing fails, skip (but usually it works)
      continue;
    }
  }
  return null;
}

export function normalizeOfferPayload(payload: any, sourceUrl: string): EtaOffer {
  // Read query params too
  const u = new URL(sourceUrl);
  const publication = u.searchParams.get("publication");
  const offerId = u.searchParams.get("offer");
  const storeSlug = u.pathname.replace(/^\/+/, "").split("/")[0] || null;

  const name = (payload?.name ?? payload?.title ?? null) as string | null;

  const price =
    toFloat(payload?.price) ??
    toFloat(pick(payload, ["pricing", "price"])) ??
    toFloat(pick(payload, ["price", "value"])) ??
    null;

  const currency =
    (payload?.currency as string | null) ??
    (payload?.priceCurrency as string | null) ??
    (pick(payload, ["pricing", "currency"]) as string | null) ??
    "DKK";

  const validFrom =
    (payload?.validFrom as string | null) ??
    (payload?.validStart as string | null) ??
    (pick(payload, ["validity", "from"]) as string | null) ??
    null;

  const validThrough =
    (payload?.validThrough as string | null) ??
    (payload?.priceValidUntil as string | null) ??
    (payload?.validTo as string | null) ??
    (pick(payload, ["validity", "to"]) as string | null) ??
    null;

  // store name sometimes embedded
  const seller = payload?.seller ?? payload?.business ?? payload?.store ?? null;
  const storeName = (seller && typeof seller === "object" ? (seller.name as string | null) : null) ?? storeSlug;

  // image
  const img = payload?.image ?? payload?.images ?? pick(payload, ["product", "image"]);
  let image: string | null = null;
  if (typeof img === "string") image = img;
  else if (Array.isArray(img) && typeof img[0] === "string") image = img[0];
  else if (img && typeof img === "object") image = (img.url as string | null) ?? (img.src as string | null) ?? null;

  // unit price
  const up = payload?.unitPrice ?? pick(payload, ["pricing", "unitPrice"]);
  let unitPrice: number | null = null;
  let unitPriceUnit: string | null = null;
  if (up && typeof up === "object") {
    unitPrice = toFloat(up.price ?? up.value);
    unitPriceUnit = (up.unit ?? up.unitText ?? null) as string | null;
  } else {
    unitPrice = toFloat(up);
  }

  const kind: "offer" | "promotion" = price !== null ? "offer" : "promotion";
  const discountPercent = kind === "promotion" ? parseDiscountPercent(name) : null;

  return {
    sourceUrl,
    store: storeName ?? null,
    publication,
    offerId,
    publicId: (payload?.publicId ?? null) as string | null,
    name,
    price,
    currency,
    unitPrice,
    unitPriceUnit,
    validFrom,
    validThrough,
    image,
    kind,
    discountPercent,
  };
}

export async function etaSearchOffers(q: string, opts?: { limit?: number; delayMs?: number }): Promise<EtaOffer[]> {
  const limit = opts?.limit ?? 80;
  const delayMs = opts?.delayMs ?? 150;

  const searchUrl = "https://etilbudsavis.dk/soeg/" + encodeURIComponent(q);
  const searchRes = await fetch(searchUrl, {
    headers: {
      "user-agent": "QuartigoBot/1.0",
      "accept": "text/html,*/*",
      "accept-language": "da-DK,da;q=0.9,en;q=0.8",
    },
    cache: "no-store",
  });

  if (!searchRes.ok) {
    throw new Error(`Search fetch failed: ${searchRes.status} ${searchRes.statusText}`);
  }

  const searchHtml = await searchRes.text();
  const offerUrls = extractOfferUrlsFromSearchHtml(searchHtml).slice(0, limit);

  const out: EtaOffer[] = [];
  for (let i = 0; i < offerUrls.length; i++) {
    const url = offerUrls[i];

    const res = await fetch(url, {
      headers: {
        "user-agent": "QuartigoBot/1.0",
        "accept": "text/html,*/*",
        "accept-language": "da-DK,da;q=0.9,en;q=0.8",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      // skip silently – you can log if you want
      await sleep(delayMs);
      continue;
    }

    const html = await res.text();
    const payload = extractOfferAppDataPayloadFromOfferHtml(html);
    if (payload) {
      out.push(normalizeOfferPayload(payload, url));
    }

    await sleep(delayMs);
  }

  return out;
}

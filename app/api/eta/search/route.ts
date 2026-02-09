import { NextResponse } from "next/server";
import { etaSearchOffers, type EtaOffer } from "@/lib/eta";

function normalizeText(x: any): string {
  return String(x ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9æøå\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAllowedStore(store: string | null): boolean {
  const s = normalizeText(store || "");

  // Exclude border shops / health shops
  const deny = ["fleggaard", "calle", "bordershop", "border shop", "helsam"];
  for (const d of deny) {
    if (s.includes(d)) return false;
  }

  // Allow Danish grocery chains (expand as needed)
  const allow = [
    "føtex",
    "fotex",
    "bilka",
    "netto",
    "rema",
    "rema 1000",
    "lidl",
    "aldi", // legacy; harmless if absent
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

  // Some offers have store casing oddities; allow if any token matches
  for (const a of allow) {
    if (s.includes(normalizeText(a))) return true;
  }

  // If store is empty/unknown, drop it for now to keep guide clean
  return false;
}

function isJunkOfferName(name: string | null): boolean {
  const n = normalizeText(name || "");
  if (!n) return false;

  // Keep this list conservative: remove obvious non-raw / non-ingredient junk
  const denySub = [
    "saftevand",
    "sodavand",
    "cola",
    "lemonade",
    "energidrik",
    "energy drink",
    "proteinbar",
    "protein bar",
    "bar ",
    " müeslibar",
    "müeslibar",
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
    if (n.includes(d.trim())) return true;
  }

  // Juice is tricky: "lime juice" / "citronjuice" should generally be excluded if you want raw ingredients only.
  // We'll treat "juice" as junk unless it's clearly a whole fruit.
  if (n.includes("juice") || n.includes("saft")) return true;

  return false;
}

function isMilkQuery(q: string): boolean {
  const qn = normalizeText(q);
  return qn === "mælk" || qn === "milk";
}

function expandQueries(q: string): string[] {
  const qn = normalizeText(q);

  if (isMilkQuery(q)) {
    return [
      "mælk",
      "skummetmælk",
      "skummemælk",
      "letmælk",
      "sødmælk",
      "minimælk",
      "kærnemælk",
      "økologisk mælk",
    ];
  }

  // If user writes "lime juice", try to search lime (raw) instead of juice
  if (qn.includes("lime") && (qn.includes("juice") || qn.includes("saft"))) {
    return ["lime", "limes", "limefrugt"];
  }

  return [q];
}

function isFlavoredMilkName(name: string | null): boolean {
  const n = normalizeText(name || "");
  if (!n) return false;

  // Catch compounds like "kakaoskummetmælk"
  const denySub = ["kakao", "chokolade", "jordbær", "vanil", "protein", "shake"];

  if (n.includes("mælk")) {
    for (const d of denySub) {
      if (n.includes(d)) return true;
    }
  }

  return false;
}

function uniqBySourceUrl(offers: EtaOffer[]): EtaOffer[] {
  const out: EtaOffer[] = [];
  const seen = new Set<string>();
  for (const o of offers) {
    const key = String(o?.sourceUrl || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

function scoreMilkOffer(name: string | null): number {
  const n = normalizeText(name || "");
  let s = 0;

  if (n.includes("skummet") || n.includes("skumme")) s += 4;
  if (n.includes("letmælk") || n.includes("let mæl")) s += 3;
  if (n.includes("sødmælk") || n.includes("sød mæl")) s += 2;
  if (n.includes("kærnemælk") || n.includes("kaernemaelk")) s += 3;
  if (n.includes("økologisk") || n.includes("oekologisk")) s += 1;

  // Plant-based allowed but not boosted as plain milk
  if (n.includes("havre") || n.includes("soja") || n.includes("mandel") || n.includes("kokos")) s -= 1;

  return -s;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) {
    return NextResponse.json({ q: "", cached: false, counts: { total: 0, offers: 0, promotions: 0 }, offers: [] });
  }

  const expanded = expandQueries(q);

  // Parallel fetch to avoid 20-30s waits
  const results = await Promise.all(
    expanded.map(async (qq) => {
      try {
        // lower delay per query now that we parallelize
        const res = await etaSearchOffers(qq, { limit: 40, delayMs: 60 });
        return (res || []) as EtaOffer[];
      } catch {
        return [] as EtaOffer[];
      }
    })
  );

  const merged = uniqBySourceUrl(results.flat().filter((o) => o && o.price !== null) as EtaOffer[]);

  let filtered = merged
    .filter((o) => isAllowedStore(o.store || null))
    .filter((o) => !isJunkOfferName(o.name || null));

  // If original query is milk, remove flavored milk (kakao etc.)
  if (isMilkQuery(q)) {
    filtered = filtered.filter((o) => !isFlavoredMilkName(o.name || null));
    filtered.sort((a, b) => scoreMilkOffer(a?.name ?? null) - scoreMilkOffer(b?.name ?? null));
  }

  return NextResponse.json({
    q,
    cached: false,
    counts: { total: filtered.length, offers: filtered.length, promotions: 0 },
    offers: filtered.slice(0, 80),
  });
}

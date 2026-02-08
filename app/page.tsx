"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { LANGS, type Lang, t } from "./i18n";

import PantryModal from "./components/PantryModal";

import OffersPanel from "@/app/components/OffersPanel";


function deriveOfferQueries(input: any): string[] {
  // Input can be: { missing }, { recipes }, { fridge }, etc.
  // We try to extract "missing ingredients" first; fallback to recipe ingredients.
  const maxQueries = 6;

  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[0-9]+([.,][0-9]+)?/g, " ")
      .replace(/\b(g|kg|ml|l|stk|stk\.|spsk|tsk|dl|cl)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const asStringList = (v: any): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) {
      const out: string[] = [];
      for (const it of v) {
        if (typeof it === "string") out.push(it);
        else if (it && typeof it === "object") {
          if (typeof it.item === "string") out.push(it.item);
          if (typeof it.name === "string") out.push(it.name);
          else if (typeof it.title === "string") out.push(it.title);
          else if (typeof it.ingredient === "string") out.push(it.ingredient);
          else if (typeof it.text === "string") out.push(it.text);
        }
      }
      return out;
    }
    // Sometimes it's an object with .data
    if (v && typeof v === "object" && Array.isArray(v.data)) return asStringList(v.data);
    return [];
  };

  const pickMissing = (obj: any): string[] => {
    if (!obj) return [];
    const root = Array.isArray(obj) ? obj[0] : obj;
    // Common shapes:
    // obj.missing, obj.missingIngredients, obj.mangler, obj.shoppingList.missing, obj.recipe.missingIngredients
    const keys = [
      "missing",
      "missingIngredients",
      "missing_items",
      "missingList",
      "missingItems",
      "mangler",
      "manglerListe",
    ];
    for (const k of keys) {
      const got = asStringList(root?.[k]);
      if (got.length) return got;
    }
    const got2 = asStringList(root?.shoppingList?.missing);
    if (got2.length) return got2;
    const got3 = asStringList(root?.recipe?.missingIngredients);
    if (got3.length) return got3;
    return [];
  };

  const pickRecipeIngredients = (obj: any): string[] => {
    if (!obj) return [];
    // If recipes is an array, take the "selected" || first recipe
    const r = Array.isArray(obj) ? obj[0] : obj;
    const keys = ["ingredients", "ingredientList", "items"];
    for (const k of keys) {
      const got = asStringList(r?.[k]);
      if (got.length) return got;
    }
    // Sometimes the recipe is a big text blob - very last resort: extract lines that look like ingredients
    if (typeof r === "string") {
      const lines = r.split("\n").map((x) => x.trim()).filter(Boolean);
      return lines.slice(0, 30);
    }
    return [];
  };

  // Priority: missing list first
  const firstNonEmpty = (...lists: string[][]): string[] => {
    for (const l of lists) {
      if (Array.isArray(l) && l.length) return l;
    }
    return [];
  };

  const rr = input?.recipesResult;
  const missing = firstNonEmpty(
    pickMissing(input),
    pickMissing(rr?.recipes),
    pickMissing(rr),
    pickMissing(input?.recipes),
    pickMissing(input?.recipe),
    pickMissing(input?.result)
  );

  const base = missing.length
    ? missing
    : pickRecipeIngredients(rr?.recipes) || pickRecipeIngredients(input?.recipes) || pickRecipeIngredients(input?.recipe) || pickRecipeIngredients(input);

  const cleaned = base.map(norm).filter(Boolean);

  // De-duplicate, drop trivial words
  const drop = new Set(["salt", "peber", "vand", "olie", "sukker", "mel", "smør"]);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const x of cleaned) {
    if (drop.has(x)) continue;
    if (!seen.has(x)) {
      seen.add(x);
      uniq.push(x);
    }
    if (uniq.length >= maxQueries) break;
  }

  // If empty, return empty (OffersPanel can show a hint)
  return uniq;
}


type ApiItem = {
  name: string;
  confidence?: number;
  kind?: string;
  contents?: string;
};

type FridgeOk = {
  ok: true;
  items: ApiItem[];
  requestId?: string;
  sha?: string;
  meta?: any;
};

type FridgeErr = {
  ok: false;
  error: string;
  requestId?: string;
  sha?: string;
  retry_after_seconds?: number;
  raw?: any;
};

type FridgeResult = FridgeOk | FridgeErr;

type Recipe = {
  title: string;
  summary?: string;
  servings?: number;
  time_minutes?: number;
  ingredients: Array<{ item: string; amount: string }>;
  steps: string[];
  tags?: string[];
  missing_items?: string[];
};

type RecipesOk = {
  ok: true;
  recipes: Recipe[];
  requestId?: string;
  sha?: string;
};

type RecipesErr = {
  ok: false;
  error: string;
  requestId?: string;
  sha?: string;
  retry_after_seconds?: number;
  raw?: any;
};

type RecipesResult = RecipesOk | RecipesErr;

function stripWhitespace(s: string) {
  return (s ?? "").trim().replace(/\s+/g, "");
}


function normalizeItem(s: string) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function dedupeCaseInsensitive(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const n = normalizeItem(raw);
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function dataUrlByteSize(dataUrl: string): number {
  const t0 = (dataUrl ?? "").trim();
  const comma = t0.indexOf(",");
  if (comma === -1) return 0;
  const b64 = t0.slice(comma + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((3 * b64.length) / 4) - pad;
}

function base64FromBytes(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      alphabet[(n >>> 18) & 63] +
      alphabet[(n >>> 12) & 63] +
      alphabet[(n >>> 6) & 63] +
      alphabet[n & 63];
  }
  if (i < bytes.length) {
    const n =
      (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] + "=" : "==";
  }
  return out;
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const b64 = base64FromBytes(bytes);
  const type =
    file.type && file.type.includes("/")
      ? file.type
      : "application/octet-stream";
  return `data:${type};base64,${b64}`;
}

async function canvasToJpegDataUrl(
  canvas: HTMLCanvasElement,
  quality = 0.82,
): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("canvas.toBlob returned null")),
      "image/jpeg",
      quality,
    );
  });
  const buf = await blob.arrayBuffer();
  const b64 = base64FromBytes(new Uint8Array(buf));
  return `data:image/jpeg;base64,${b64}`;
}

async function downscaleToJpegDataUrl(
  file: File,
  opts: { maxDim: number; quality: number },
) {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    const url = URL.createObjectURL(file);

    el.onload = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      resolve(el);
    };

    el.onerror = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      reject(new Error("Image decode failed."));
    };

    try {
      el.src = url;
    } catch (e) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      reject(e);
    }
  });

  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;

  const scale = Math.min(1, opts.maxDim / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context failed.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const jpegDataUrl = await canvasToJpegDataUrl(canvas, opts.quality);
  return { jpegDataUrl, width: w, height: h };
}

function langDir(lang: Lang): "ltr" | "rtl" {
  return LANGS.find((x) => x.code === lang)?.dir ?? "ltr";
}

export default function Page() {
  
  const [pantryOpen, setPantryOpen] = useState(false);
const fileRef = useRef<HTMLInputElement | null>(null);

  const [lang, setLang] = useState<Lang>("da");

  const [originalDataUrl, setOriginalDataUrl] = useState("");
  const [jpegDataUrl, setJpegDataUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const [apiBusy, setApiBusy] = useState(false);
  const [apiResult, setApiResult] = useState<FridgeResult | null>(null);

  // Confirm layer (user edits this list; recipes are generated ONLY from here)
  const [confirmedItems, setConfirmedItems] = useState<string[]>([]);
  const [newConfirmedItem, setNewConfirmedItem] = useState<string>("");

  const [itemsLang, setItemsLang] = useState<Lang>("da");
const [error, setError] = useState("");

  const [recipesBusy, setRecipesBusy] = useState(false);
  const [recipesResult, setRecipesResult] = useState<RecipesResult | null>(
    null,
  );

  const offerQueries = useMemo(() => {
    // Primært: opskriftens missing_items (hvis backend leverer dem)
    // Fallback: deriveOfferQueries prøver også at falde tilbage til ingredienser.
    return deriveOfferQueries({ recipesResult, fridge: confirmedItems });
  }, [recipesResult, confirmedItems]);
  const [constraints, setConstraints] = useState<string>(
    t("da", "constraints_placeholder"),
  );

  const [sha, setSha] = useState<string>("");

  const lastConfirmedKeyRef = useRef<string>("");

  const MAX_DIM = 1280;
  const JPEG_QUALITY = 0.82;
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ff_lang") as Lang | null;
      if (saved && LANGS.some((x) => x.code === saved)) setLang(saved);
    } catch {}
  }, []);

  

  // Reset analyzed results on language change (simplest stable behavior)
  useEffect(() => {
    setApiResult(null);
    setError("");
  }, [lang]);
useEffect(() => {
    if (!apiResult || apiResult.ok !== true || apiResult.items.length === 0) return;
    if (itemsLang === lang) return;

    (async () => {
      try {
        const res = await fetch("/api/translate-items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            language: lang,
            items: apiResult.items.map((it: any) => it?.name ?? ""),
          }),
        });

        const json = await res.json().catch(() => ({} as any));
        if (!json || json.ok !== true || !Array.isArray(json.items)) return;

        setApiResult((prev: any) => {
          if (!prev || prev.ok !== true || !Array.isArray(prev.items)) return prev;
          const mapped = prev.items.map((it: any, i: number) => ({
            ...it,
            name: (json.items[i] ?? it.name),
          }));
          return { ...prev, items: mapped };
        });

        setItemsLang(lang);
      } catch {
        // ignore
      }
    })();
  }, [lang, apiResult, itemsLang]);
useEffect(() => {
    try {
      localStorage.setItem("ff_lang", lang);
    } catch {}
  }, [lang]);

  // When we get a NEW scan result, initialize confirmed list from detected items
  useEffect(() => {
    if (!apiResult || apiResult.ok !== true) {
      setConfirmedItems([]);
      setNewConfirmedItem("");
      lastConfirmedKeyRef.current = "";
      return;
    }
    const key = String((apiResult as any).sha || (apiResult as any).requestId || "");
    if (key && key === lastConfirmedKeyRef.current) return;
    lastConfirmedKeyRef.current = key;

    const names = dedupeCaseInsensitive((apiResult as any).items.map((it: any) => it?.name ?? ""));
    setConfirmedItems(names);
    setNewConfirmedItem("");
  }, [apiResult]);

  useEffect(() => {
    // Hvis vi tidligere satte placeholder-teksten som value, så ryd den.
    if (constraints === t("da", "constraints_placeholder")) {
      setConstraints("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let dead = false;
    fetch("/api/version")
      .then((r) => r.json())
      .then((j) => {
        if (dead) return;
        const v = typeof j?.sha === "string" ? j.sha : "";
        setSha(v);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);

  const originalBytes = useMemo(
    () => (originalDataUrl ? dataUrlByteSize(originalDataUrl) : 0),
    [originalDataUrl],
  );
  const jpegBytes = useMemo(
    () => (jpegDataUrl ? dataUrlByteSize(jpegDataUrl) : 0),
    [jpegDataUrl],
  );

  const chosen = useMemo(() => {
    if (!originalDataUrl && !jpegDataUrl) return { label: "none", dataUrl: "" };
    if (originalDataUrl && !jpegDataUrl)
      return { label: "original", dataUrl: originalDataUrl };
    if (!originalDataUrl && jpegDataUrl)
      return { label: "jpeg", dataUrl: jpegDataUrl };
    return originalBytes <= jpegBytes
      ? { label: "original", dataUrl: originalDataUrl }
      : { label: "jpeg", dataUrl: jpegDataUrl };
  }, [originalDataUrl, jpegDataUrl, originalBytes, jpegBytes]);

  const statusLabel = apiBusy
    ? t(lang, "status_analyzing")
    : busy
      ? t(lang, "status_preparing")
      : t(lang, "status_ready");
  const versionShort = sha && sha !== "unknown" ? sha.slice(0, 7) : "";
  const dir = langDir(lang);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    setApiResult(null);
    setRecipesResult(null);

    const file = e.target.files?.[0];

    if (!file) {
      setOriginalDataUrl("");
      setJpegDataUrl("");
      return;
    }

    setBusy(true);
    try {
      const orig = await fileToDataUrl(file);
      setOriginalDataUrl(orig);

      try {
        const { jpegDataUrl: jpg } = await downscaleToJpegDataUrl(file, {
          maxDim: MAX_DIM,
          quality: JPEG_QUALITY,
        });
        setJpegDataUrl(jpg || "");
      } catch {
        setJpegDataUrl("");
      }
    } catch (err: any) {
      setError(err?.message ?? "Image read error.");
      setOriginalDataUrl("");
      setJpegDataUrl("");
    } finally {
      setBusy(false);
      try {
        e.target.value = "";
      } catch {}
    }
  }

  async function callFridge() {
    setError("");
    setApiResult(null);
    setRecipesResult(null);

    const payload = stripWhitespace(chosen.dataUrl);
    if (!payload) {
      setError(t(lang, "missing_image"));
      return;
    }

    setApiBusy(true);
    try {
      const res = await fetch("/api/fridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: payload, mode: "thorough", language: lang }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setApiResult({
          ok: false,
          error: json?.error ?? `HTTP ${res.status}`,
          requestId: json?.requestId,
          sha: json?.sha,
          retry_after_seconds: json?.retry_after_seconds,
          raw: json,
        });
        return;
      }

      const items: ApiItem[] = Array.isArray(json?.items)
        ? json.items
            .map((it: any) => ({
              name: String(it?.name ?? "").trim(),
              confidence:
                typeof it?.confidence === "number" ? it.confidence : undefined,
              kind: typeof it?.kind === "string" ? it.kind : undefined,
              contents:
                typeof it?.contents === "string" ? it.contents : undefined,
            }))
            .filter((it: ApiItem) => it.name.length > 0)
        : [];

      setApiResult({
        ok: true,
        items,
        requestId: json?.requestId,
        sha: json?.sha,
        meta: json?.meta,
      });
    
      setItemsLang(lang);
} catch (err: any) {
      setApiResult({ ok: false, error: err?.message ?? "Network error." });
    } finally {
      setApiBusy(false);
    }
  }

  async function callRecipes() {
    setRecipesResult(null);

    const confirmed = dedupeCaseInsensitive(confirmedItems);

    if (confirmed.length === 0) {
      setRecipesResult({ ok: false, error: t(lang, "missing_confirmed_items") });
      return;
    }

    setRecipesBusy(true);
    try {
      const pantry = (() => {
      try {
      const raw = localStorage.getItem("quartigo_pantry_v1");
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(String) : [];
      } catch {
      return [];
      }
      })();


      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fridge_items: confirmed,
          pantry_items: pantry,
          constraints,
          count: 4,
          language: lang,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setRecipesResult({
          ok: false,
          error: json?.error ?? `HTTP ${res.status}`,
          requestId: json?.requestId,
          sha: json?.sha,
          retry_after_seconds: json?.retry_after_seconds,
          raw: json,
        });
        return;
      }

      const recipes: Recipe[] = Array.isArray(json?.recipes)
        ? json.recipes
        : [];
      setRecipesResult({
        ok: true,
        recipes,
        requestId: json?.requestId,
        sha: json?.sha,
      });
    } catch (err: any) {
      setRecipesResult({ ok: false, error: err?.message ?? "Network error." });
    } finally {
      setRecipesBusy(false);
    }
  }

  function updateConfirmedAt(index: number, value: string) {
    setConfirmedItems((prev) => {
      const next = [...prev];
      next[index] = value;
      return dedupeCaseInsensitive(next);
    });
  }

  function removeConfirmedAt(index: number) {
    setConfirmedItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addConfirmed() {
    const v = normalizeItem(newConfirmedItem);
    if (!v) return;
    setConfirmedItems((prev) => dedupeCaseInsensitive([...prev, v]));
    setNewConfirmedItem("");
  }


  const sortedItems = useMemo(() => {
    if (!apiResult || apiResult.ok !== true) return [];
    const copy = [...apiResult.items];
    copy.sort((a, b) => {
      const ac =
        typeof a.confidence === "number" && Number.isFinite(a.confidence)
          ? a.confidence
          : -1;
      const bc =
        typeof b.confidence === "number" && Number.isFinite(b.confidence)
          ? b.confidence
          : -1;
      return bc - ac;
    });
    return copy;
  }, [apiResult]);

  return (
    <main dir={dir} className="min-h-screen bg-white text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-white to-slate-50" />
        <div className="absolute -top-40 left-[-10%] h-[520px] w-[520px] rounded-full bg-blue-200/35 blur-3xl" />
        <div className="absolute -top-24 right-[-10%] h-[520px] w-[520px] rounded-full bg-emerald-200/30 blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="mb-8 flex items-start justify-between gap-6">
          <div>
<div className="text-xs font-semibold tracking-[0.18em] text-slate-500">
              {t(lang, "brand_line")}
            </div>
<h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-900">
              Smart Shopping
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-600">
              {t(lang, "subtitle")}
            </p>


            <div className="mt-4 max-w-xl rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {t(lang, "pantry_open")}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {t(lang, "pantry_help")}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setPantryOpen(true)}
                  className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  {t(lang, "pantry_open")}
                </button>
              </div>
            </div>

          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 shadow-sm backdrop-blur">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]" />
              <span className="text-sm font-medium text-slate-700">
                {statusLabel}
              </span>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 shadow-sm backdrop-blur">
              <span className="text-xs font-semibold text-slate-600">
                {t(lang, "language_label")}
              </span>
              <select
                value={lang}
                onChange={(e) => {
                  const v = e.target.value as Lang;
                  if (LANGS.some((x) => x.code === v)) setLang(v);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-200"
              >
                {LANGS.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-base font-semibold text-slate-900">
                  {t(lang, "image_card_title")}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {t(lang, "image_card_subtitle")}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onPickFile}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy || apiBusy || recipesBusy}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t(lang, "upload")}
                </button>

                <button
                  type="button"
                  onClick={callFridge}
                  disabled={apiBusy || busy || recipesBusy || !chosen.dataUrl}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {apiBusy ? t(lang, "analyzing") : t(lang, "analyze")}
                </button>
              </div>
            </div>

            <div className="px-6 py-6">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy || apiBusy || recipesBusy}
                className="group relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60 p-0 text-left shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="absolute inset-0 opacity-0 transition group-hover:opacity-100">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-transparent to-emerald-50" />
                </div>

                <div className="relative">
                  {chosen.dataUrl ? (
                    <img
                      src={chosen.dataUrl}
                      alt="Preview"
                      className="h-[340px] w-full bg-white object-contain"
                    />

                                      ) : (
                    <div className="flex h-[340px] flex-col items-center justify-center gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
                        {t(lang, "tap_to_choose")}
                      </div>
                      <div className="text-xs text-slate-500">
                        {t(lang, "formats_hint")}
                      </div>
                    </div>
                  )}
                </div>
              </button>


              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>offerQueries: {JSON.stringify(offerQueries)}</div>



              <OffersPanel queries={offerQueries} />

              {error ? (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <div className="text-sm font-semibold text-rose-900">
                    {t(lang, "error_title")}
                  </div>
                  <div className="mt-1 text-sm text-rose-800">{error}</div>
                </div>
              ) : null}

              {versionShort ? (
                <div className="mt-4 text-xs text-slate-400">
                  sha: {versionShort}
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="text-base font-semibold text-slate-900">
                {t(lang, "ingredients_title")}
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {t(lang, "ingredients_subtitle")}
              </div>
            </div>

            <div className="px-6 py-6">
              {!apiResult ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
                  <div className="text-sm font-semibold text-slate-900">
                    {t(lang, "no_analysis_title")}
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {t(lang, "no_analysis_subtitle")}
                  </div>
                </div>
              ) : apiResult.ok === false ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
                  <div className="text-sm font-semibold text-rose-900">
                    {apiResult.error}
                  </div>
                </div>
              ) : sortedItems.length ? (
                <div className="space-y-2">
                  {sortedItems.map((it, idx) => (
                    <div
                      key={`${it.name}-${idx}`}
                      className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="text-sm font-semibold text-slate-900">
                        {it.name}
                      </div>
                      {typeof it.confidence === "number" ? (
                        <div className="text-xs font-semibold text-slate-500">
                          {Math.round(it.confidence * 100)}%
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
                  <div className="text-sm font-semibold text-slate-900">
                    {t(lang, "no_items_title")}
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {t(lang, "no_items_subtitle")}
                  </div>
                </div>
              )}
              <div className="mt-6">
                <div className="text-sm font-semibold text-slate-900">
                  {t(lang, "confirm_items_title")}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {t(lang, "confirm_items_subtitle")}
                </div>

                <div className="mt-3 space-y-2">
                  {confirmedItems.length ? (
                    confirmedItems.map((name, idx) => (
                      <div
                        key={`${name}-${idx}`}
                        className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2"
                      >
                        <input
                          className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                          value={name}
                          onChange={(e) => updateConfirmedAt(idx, e.target.value)}
                          onBlur={(e) => updateConfirmedAt(idx, e.target.value)}
                        />
                        <button
                          type="button"
                          className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-600 hover:bg-slate-50"
                          onClick={() => removeConfirmedAt(idx)}
                          aria-label={t(lang, "delete_item")}
                          title={t(lang, "delete_item")}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
                      {t(lang, "no_confirmed_items")}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                    value={newConfirmedItem}
                    onChange={(e) => setNewConfirmedItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addConfirmed();
                      }
                    }}
                    placeholder={t(lang, "add_item_placeholder")}
                  />
                  <button
                    type="button"
                    className="h-10 whitespace-nowrap rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                    onClick={addConfirmed}
                  >
                    {t(lang, "add_item")}
                  </button>
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  {t(lang, "dedupe_hint")}
                </div>
              </div>



              <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-base font-semibold text-slate-900">
                  {t(lang, "recipes_title")}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {t(lang, "recipes_subtitle")}
                </div>

                <textarea
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                  placeholder={t(lang, "constraints_placeholder")}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-200"
                  rows={3}
                />

                <button
                  type="button"
                  onClick={callRecipes}
                  disabled={recipesBusy || apiBusy || busy}
                  className="mt-3 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recipesBusy
                    ? t(lang, "generating")
                    : t(lang, "make_recipes")}
                </button>

                {recipesResult ? (
                  recipesResult.ok === false ? (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                      <div className="text-sm font-semibold text-rose-900">
                        {recipesResult.error}
                      </div>
                    </div>
                  ) : recipesResult.recipes?.length ? (
                    <div className="mt-4 space-y-3">
                      {recipesResult.recipes.map((r, idx) => (
                        <div
                          key={`${r.title}-${idx}`}
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
                        >
                          <div className="text-base font-semibold text-slate-900">
                            {r.title}
                          </div>
                          {r.summary ? (
                            <div className="mt-1 text-sm text-slate-600">
                              {r.summary}
                            </div>
                          ) : null}

                          {Array.isArray(r.missing_items) && r.missing_items.length ? (
                            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3">
                              <div className="text-xs font-semibold text-rose-900">
                                {t(lang, "missing_items_title")}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {r.missing_items.map((m, mi) => (
                                  <span
                                    key={`${m}-${mi}`}
                                    className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-900"
                                  >
                                    {m}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 text-xs font-semibold text-slate-500">
                              {t(lang, "missing_items_none")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null
                ) : null}

                <div className="mt-4 text-xs text-slate-400">
                  {t(lang, "api_footer")}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    

      <PantryModal
        lang={lang}
        open={pantryOpen}
        onClose={() => setPantryOpen(false)}
        title={t(lang, "pantry_title")}
        subtitle={t(lang, "pantry_subtitle")}
        selectedLabel={t(lang, "pantry_selected")}
        selectAllLabel={t(lang, "pantry_select_all")}
        resetLabel={t(lang, "pantry_reset")}
      />
</main>
  );
}
{/* Eksempel: <OffersPanel queries={ingredients.map(x=>x.name).slice(0,4)} /> */}

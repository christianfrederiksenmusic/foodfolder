"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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

function dataUrlByteSize(dataUrl: string): number {
  const t = (dataUrl ?? "").trim();
  const comma = t.indexOf(",");
  if (comma === -1) return 0;
  const b64 = t.slice(comma + 1);
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
      reject(new Error("Kunne ikke indlæse billedet (image decode fejl)."));
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
  if (!ctx) throw new Error("Canvas context fejlede.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const jpegDataUrl = await canvasToJpegDataUrl(canvas, opts.quality);
  return { jpegDataUrl, width: w, height: h };
}

function fmtConfidence(c?: number) {
  if (typeof c !== "number" || !Number.isFinite(c)) return "";
  return `${Math.round(c * 100)}%`;
}

function fmtKB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function Page() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [pickedInfo, setPickedInfo] = useState<{
    name: string;
    type: string;
    size: number;
  } | null>(null);
  const [originalDataUrl, setOriginalDataUrl] = useState("");
  const [jpegDataUrl, setJpegDataUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const [apiBusy, setApiBusy] = useState(false);
  const [apiResult, setApiResult] = useState<FridgeResult | null>(null);
  const [error, setError] = useState("");

  const [recipesBusy, setRecipesBusy] = useState(false);
  const [recipesResult, setRecipesResult] = useState<RecipesResult | null>(
    null,
  );
  const [constraints, setConstraints] = useState<string>(
    "hurtigt, få ingredienser, ingen fancy udstyr",
  );

  const [sha, setSha] = useState<string>("");

  const MAX_DIM = 1280;
  const JPEG_QUALITY = 0.82;

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

  const chosenBytes = useMemo(
    () => dataUrlByteSize(chosen.dataUrl),
    [chosen.dataUrl],
  );
  const statusLabel = apiBusy ? "Analyserer" : busy ? "Forbereder" : "Klar";

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    setApiResult(null);
    setRecipesResult(null);

    const file = e.target.files?.[0];

    if (!file) {
      setPickedInfo(null);
      setOriginalDataUrl("");
      setJpegDataUrl("");
      return;
    }

    setPickedInfo({
      name: file.name,
      type: file.type || "(ukendt)",
      size: file.size,
    });

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
      setError(err?.message ?? "Ukendt fejl ved billed-læsning.");
      setPickedInfo(null);
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
      setError("Vælg et billede først.");
      return;
    }

    setApiBusy(true);
    try {
      const res = await fetch("/api/fridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: payload, mode: "thorough" }),
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
    } catch (err: any) {
      setApiResult({ ok: false, error: err?.message ?? "Netværksfejl." });
    } finally {
      setApiBusy(false);
    }
  }

  async function callRecipes() {
    setRecipesResult(null);

    if (!apiResult || apiResult.ok !== true || apiResult.items.length === 0) {
      setRecipesResult({
        ok: false,
        error: "Kør analyse først (vi mangler ingredienser).",
      });
      return;
    }

    setRecipesBusy(true);
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: apiResult.items,
          constraints,
          count: 4,
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
      setRecipesResult({ ok: false, error: err?.message ?? "Netværksfejl." });
    } finally {
      setRecipesBusy(false);
    }
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

  const versionShort = sha && sha !== "unknown" ? sha.slice(0, 7) : "";

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-white to-slate-50" />
        <div className="absolute -top-40 left-[-10%] h-[520px] w-[520px] rounded-full bg-blue-200/35 blur-3xl" />
        <div className="absolute -top-24 right-[-10%] h-[520px] w-[520px] rounded-full bg-emerald-200/30 blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="mb-8 flex items-start justify-between gap-6">
          <div>
            <div className="text-xs font-semibold tracking-[0.18em] text-slate-500">
              QARTIGO
            </div>
            <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-900">
              FoodFolder
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-600">
              Upload et foto af dit køleskab. Få ingredienser udtrukket - og lav
              opskrifter på få sekunder.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 shadow-sm backdrop-blur">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]" />
              <span className="text-sm font-medium text-slate-700">
                {statusLabel}
              </span>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-base font-semibold text-slate-900">
                  Billede
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Vælg et foto og kør analyse.
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
                  Upload
                </button>

                <button
                  type="button"
                  onClick={callFridge}
                  disabled={apiBusy || busy || recipesBusy || !chosen.dataUrl}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {apiBusy ? "Analyserer..." : "Analyser"}
                </button>
              </div>
            </div>

            <div className="px-6 py-6">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy || apiBusy || recipesBusy}
                className="group relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60 p-0 text-left shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Vælg billede"
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
                        Klik for at vælge et billede
                      </div>
                      <div className="text-xs text-slate-500">
                        JPG/PNG/HEIC - vi optimerer automatisk payloaden
                      </div>
                    </div>
                  )}
                </div>
              </button>

              {error ? (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <div className="text-sm font-semibold text-rose-900">
                    Fejl
                  </div>
                  <div className="mt-1 text-sm text-rose-800">{error}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="text-base font-semibold text-slate-900">
                Ingredienser
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Efter analysen kan du generere opskrifter.
              </div>
            </div>

            <div className="px-6 py-6">
              {!apiResult ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
                  <div className="text-sm font-semibold text-slate-900">
                    Ingen analyse endnu
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    Upload et billede og tryk “Analyser”.
                  </div>
                </div>
              ) : apiResult.ok === false ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
                  <div className="text-sm font-semibold text-rose-900">
                    {apiResult.error}
                  </div>
                  <div className="mt-2 text-sm text-rose-800">
                    {apiResult.requestId
                      ? `requestId: ${apiResult.requestId}`
                      : ""}
                  </div>
                </div>
              ) : sortedItems.length ? (
                <>
                  <ul className="space-y-2">
                    {sortedItems.map((it, idx) => {
                      const conf = fmtConfidence(it.confidence);
                      return (
                        <li
                          key={idx}
                          className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">
                              {it.name}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {it.kind ? (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                                  {it.kind}
                                </span>
                              ) : null}
                              {it.contents ? (
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                                  contents: {it.contents}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="shrink-0">
                            <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
                              {conf || "—"}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="text-sm font-semibold text-slate-900">
                      Lav opskrifter
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      Skriv constraints og generér forslag.
                    </div>

                    <textarea
                      value={constraints}
                      onChange={(e) => setConstraints(e.target.value)}
                      rows={3}
                      className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-200"
                    />

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={callRecipes}
                        disabled={recipesBusy || apiBusy}
                        className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {recipesBusy ? "Genererer..." : "Lav opskrifter"}
                      </button>

                      <div className="text-xs text-slate-500">
                        {versionShort ? `prod: ${versionShort}` : ""}
                      </div>
                    </div>
                  </div>

                  {recipesResult ? (
                    <div className="mt-6">
                      {recipesResult.ok === false ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
                          <div className="text-sm font-semibold text-rose-900">
                            {recipesResult.error}
                          </div>
                          <div className="mt-2 text-sm text-rose-800">
                            {recipesResult.requestId
                              ? `requestId: ${recipesResult.requestId}`
                              : ""}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {recipesResult.recipes.map((r, i) => (
                            <div
                              key={i}
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-3">
                                <div className="text-base font-semibold text-slate-900">
                                  {r.title}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {typeof r.time_minutes === "number"
                                    ? `${r.time_minutes} min`
                                    : ""}
                                  {typeof r.servings === "number"
                                    ? ` | ${r.servings} pers`
                                    : ""}
                                </div>
                              </div>
                              {r.summary ? (
                                <div className="mt-2 text-sm text-slate-600">
                                  {r.summary}
                                </div>
                              ) : null}

                              <div className="mt-3 text-sm font-semibold text-slate-900">
                                Ingredienser
                              </div>
                              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                                {r.ingredients.map((ing, k) => (
                                  <li
                                    key={k}
                                    className="flex justify-between gap-3"
                                  >
                                    <span className="truncate">{ing.item}</span>
                                    <span className="shrink-0 text-slate-500">
                                      {ing.amount}
                                    </span>
                                  </li>
                                ))}
                              </ul>

                              <div className="mt-4 text-sm font-semibold text-slate-900">
                                Trin
                              </div>
                              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                                {r.steps.map((s, k) => (
                                  <li key={k}>{s}</li>
                                ))}
                              </ol>

                              {Array.isArray(r.tags) && r.tags.length ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {r.tags.map((t, k) => (
                                    <span
                                      key={k}
                                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
                  <div className="text-sm font-semibold text-slate-900">
                    Ingen items
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    Prøv et skarpere/beskåret billede.
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <footer className="mt-10 flex items-center justify-between text-xs text-slate-500">
          <div>API: /api/fridge + /api/recipes</div>
          <div className="hidden sm:block">
            {versionShort ? `version: ${versionShort}` : ""}
          </div>
        </footer>
      </div>
    </main>
  );
}

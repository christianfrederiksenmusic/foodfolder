"use client";

import React, { useMemo, useState } from "react";

type ApiResponse =
  | { ok: true; ingredients: string[]; raw?: any }
  | { ok: false; error: string; raw?: any };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let b = bytes;
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

// Nøjagtig byte-size af en dataURL (base64 payloaden)
function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const base64 = dataUrl.slice(comma + 1);
  // Base64 size -> bytes (minus padding)
  const len = base64.length;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Kunne ikke læse filen."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

async function downscaleToJpegDataUrl(
  dataUrl: string,
  opts: {
    maxDim: number; // fx 1280
    quality: number; // fx 0.8
  }
): Promise<{ jpegDataUrl: string; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Kunne ikke indlæse billedet i browseren."));
    i.src = dataUrl;
  });

  const { maxDim, quality } = opts;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  let targetW = w;
  let targetH = h;

  // Kun downscale (aldrig upscale)
  const scale = Math.min(1, maxDim / Math.max(w, h));
  targetW = Math.max(1, Math.round(w * scale));
  targetH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context fejlede.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const jpegDataUrl = canvas.toDataURL("image/jpeg", quality);
  return { jpegDataUrl, width: targetW, height: targetH };
}

export default function Page() {
  const [fileName, setFileName] = useState<string>("");
  const [originalDataUrl, setOriginalDataUrl] = useState<string>("");
  const [jpegDataUrl, setJpegDataUrl] = useState<string>("");
  const [jpegDims, setJpegDims] = useState<{ w: number; h: number } | null>(null);

  const [busy, setBusy] = useState<boolean>(false);
  const [apiBusy, setApiBusy] = useState<boolean>(false);
  const [apiResult, setApiResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string>("");

  // Tuning: hold det simpelt og stabilt
  const MAX_DIM = 1280;
  const JPEG_QUALITY = 0.82;

  const originalBytes = useMemo(
    () => (originalDataUrl ? dataUrlByteSize(originalDataUrl) : 0),
    [originalDataUrl]
  );
  const jpegBytes = useMemo(
    () => (jpegDataUrl ? dataUrlByteSize(jpegDataUrl) : 0),
    [jpegDataUrl]
  );

  // Vælger automatisk den mindste
  const chosen = useMemo(() => {
    if (!originalDataUrl && !jpegDataUrl) return { label: "Ingen", dataUrl: "" };
    if (originalDataUrl && !jpegDataUrl) return { label: "Original", dataUrl: originalDataUrl };
    if (!originalDataUrl && jpegDataUrl) return { label: "Komprimeret", dataUrl: jpegDataUrl };
    // begge findes:
    if (originalBytes <= jpegBytes) return { label: "Original", dataUrl: originalDataUrl };
    return { label: "Komprimeret", dataUrl: jpegDataUrl };
  }, [originalDataUrl, jpegDataUrl, originalBytes, jpegBytes]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    setApiResult(null);

    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setBusy(true);
    try {
      const orig = await fileToDataUrl(file);
      setOriginalDataUrl(orig);

      // Lav “komprimeret” (downscale + jpeg) uanset original format
      const { jpegDataUrl: jpg, width, height } = await downscaleToJpegDataUrl(orig, {
        maxDim: MAX_DIM,
        quality: JPEG_QUALITY,
      });
      setJpegDataUrl(jpg);
      setJpegDims({ w: width, h: height });
    } catch (err: any) {
      setError(err?.message ?? "Ukendt fejl ved billedbehandling.");
      setOriginalDataUrl("");
      setJpegDataUrl("");
      setJpegDims(null);
    } finally {
      setBusy(false);
    }
  }

  async function callApi() {
    setError("");
    setApiResult(null);

    if (!chosen.dataUrl) {
      setError("Vælg et billede først.");
      return;
    }

    setApiBusy(true);
    try {
      const res = await fetch("/api/fridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: chosen.dataUrl,
          meta: {
            fileName,
            pickedVariant: chosen.label,
            originalBytes,
            jpegBytes,
            maxDim: MAX_DIM,
            jpegQuality: JPEG_QUALITY,
          },
        }),
      });

      const json = (await res.json()) as any;

      if (!res.ok) {
        setApiResult({ ok: false, error: json?.error ?? `HTTP ${res.status}`, raw: json });
        return;
      }

      // Forventet shape: { ingredients: [...] } (men vi accepterer lidt variation)
      const ingredients = Array.isArray(json?.ingredients)
        ? json.ingredients.map((x: any) => String(x))
        : Array.isArray(json)
          ? json.map((x: any) => String(x))
          : [];

      setApiResult({ ok: true, ingredients, raw: json });
    } catch (err: any) {
      setApiResult({ ok: false, error: err?.message ?? "Netværksfejl." });
    } finally {
      setApiBusy(false);
    }
  }

  const chosenIsOriginal = chosen.label === "Original";
  const chosenIsJpeg = chosen.label === "Komprimeret";

  return (
    <main style={{ maxWidth: 920, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Foodfolder - Fridge Scan</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Upload et billede. UI vælger automatisk den mindste payload (Original dataURL vs downscaled JPEG) og sender kun den mindste til API’et.
      </p>

      <section style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Vælg billede</label>
        <input type="file" accept="image/*" onChange={onPickFile} />
        {fileName ? <div style={{ marginTop: 8, opacity: 0.8 }}>Fil: {fileName}</div> : null}
        {busy ? <div style={{ marginTop: 8 }}>Behandler billede…</div> : null}
        {error ? <div style={{ marginTop: 8, color: "crimson" }}>{error}</div> : null}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>Original</h2>
            <div style={{ opacity: 0.75 }}>{originalDataUrl ? formatBytes(originalBytes) : "-"}</div>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
            {originalDataUrl ? (chosenIsOriginal ? "(valgt)" : "(ikke valgt)") : "(ingen)"}
          </div>
          <div style={{ marginTop: 12, borderRadius: 10, overflow: "hidden", background: "rgba(0,0,0,0.03)", minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {originalDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={originalDataUrl} alt="Original preview" style={{ width: "100%", height: "auto", display: "block" }} />
            ) : (
              <div style={{ opacity: 0.6 }}>Ingen preview</div>
            )}
          </div>
        </div>

        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>Komprimeret (downscaled JPEG)</h2>
            <div style={{ opacity: 0.75 }}>{jpegDataUrl ? formatBytes(jpegBytes) : "-"}</div>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
            {jpegDataUrl ? (chosenIsJpeg ? "(valgt)" : "(ikke valgt)") : "(ingen)"}
            {jpegDims ? <span style={{ marginLeft: 8 }}>(ca. {jpegDims.w}x{jpegDims.h})</span> : null}
          </div>
          <div style={{ marginTop: 12, borderRadius: 10, overflow: "hidden", background: "rgba(0,0,0,0.03)", minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {jpegDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={jpegDataUrl} alt="JPEG preview" style={{ width: "100%", height: "auto", display: "block" }} />
            ) : (
              <div style={{ opacity: 0.6 }}>Ingen preview</div>
            )}
          </div>
        </div>
      </section>

      <section style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Sendt til API: {chosen.label}</div>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
              Original: {originalDataUrl ? formatBytes(originalBytes) : "-"} · Komprimeret: {jpegDataUrl ? formatBytes(jpegBytes) : "-"}
            </div>
          </div>

          <button
            onClick={callApi}
            disabled={apiBusy || busy || !chosen.dataUrl}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.18)",
              background: apiBusy || busy || !chosen.dataUrl ? "rgba(0,0,0,0.06)" : "black",
              color: apiBusy || busy || !chosen.dataUrl ? "rgba(0,0,0,0.5)" : "white",
              cursor: apiBusy || busy || !chosen.dataUrl ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {apiBusy ? "Kalder API…" : "Analyser billede"}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {apiResult?.ok ? (
            <div style={{ borderRadius: 10, padding: 12, background: "rgba(0, 128, 0, 0.08)" }}>

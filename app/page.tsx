"use client";

function sanitizeDataUrl(u: string): string {
  return (u ?? "").trim().replace(/\s+/g, "");
}


function base64ByteLength(b64: string): number {
  const cleaned = (b64 ?? "").replace(/\s/g, "");
  if (!cleaned) return 0;
  const pad = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - pad);
}

function dataUrlByteLength(dataUrl: string): number {
  const t = (dataUrl ?? "").trim();
  const comma = t.indexOf(",");
  if (comma === -1) return 0;
  return base64ByteLength(t.slice(comma + 1));
}


import React, { useMemo, useRef, useState } from "react";

type ApiItem = { name: string; confidence?: number };
type ApiOk = { ok: true; items: ApiItem[]; raw: any };
type ApiErr = { ok: false; error: string; raw: any };
type ApiResponse = ApiOk | ApiErr | null;

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

function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const base64 = dataUrl.slice(comma + 1);
  const len = base64.length;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Kunne ikke læse filen (FileReader fejl)."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

async function downscaleToJpegDataUrl(
  dataUrl: string,
  opts: { maxDim: number; quality: number }
): Promise<{ jpegDataUrl: string; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Kunne ikke indlæse dataURL i <img> (image decode fejl)."));
    i.src = dataUrl;
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const scale = Math.min(1, opts.maxDim / Math.max(w, h));
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context fejlede.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const jpegDataUrl = canvas.toDataURL("image/jpeg", opts.quality);
  return { jpegDataUrl, width: targetW, height: targetH };
}

function extractItems(json: any): ApiItem[] {
  const cleanName = (x: any) => String(x ?? "").trim();

  if (json && Array.isArray(json.items)) {
    return json.items
      .map((it: any) => ({
        name: cleanName(it?.name),
        confidence: typeof it?.confidence === "number" ? it.confidence : undefined,
      }))
      .filter((it: ApiItem) => it.name.length > 0);
  }

  // fallback hvis API en dag sender ingredients[]
  if (json && Array.isArray(json.ingredients)) {
    return json.ingredients
      .map((name: any) => ({ name: cleanName(name) }))
      .filter((it: ApiItem) => it.name.length > 0);
  }

  const nested = json?.data ?? json?.result ?? json?.output;
  if (nested) return extractItems(nested);

  return [];
}

function fmtConfidence(c?: number): string | null {
  if (typeof c !== "number") return null;
  if (!Number.isFinite(c)) return null;
  const clamped = Math.max(0, Math.min(1, c));
  return `${Math.round(clamped * 100)}%`;
}

export default function Page() {
  const SHOW_RAW = process.env.NODE_ENV !== "production";

  

  const fileInputRef = useRef<HTMLInputElement | null>(null);
const [pickedFileInfo, setPickedFileInfo] = useState<{
    name: string;
    type: string;
    size: number;
  } | null>(null);

  const [originalDataUrl, setOriginalDataUrl] = useState("");
  const [jpegDataUrl, setJpegDataUrl] = useState("");
  const [jpegDims, setJpegDims] = useState<{ w: number; h: number } | null>(null);

  const [busy, setBusy] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiResult, setApiResult] = useState<ApiResponse>(null);
  const [error, setError] = useState("");

  // Global error catcher (Safari giver ellers kun "The string did not match the expected pattern.")
  React.useEffect(() => {
    const onError = (event: any) => {
      try {
        const loc = event?.filename ? ` @ ${event.filename}:${event.lineno ?? "?"}:${event.colno ?? "?"}` : "";
        const msg = (event?.message || String(event?.error?.message || event?.error || event)) + loc;
        const stack = event?.error?.stack ? "\n" + event.error.stack : "";
        console.error("GLOBAL_ERROR:", msg, event?.error);
        setError(`GLOBAL_ERROR: ${msg}${stack}`);
      } catch (e) {
        console.error("GLOBAL_ERROR (handler failed):", e);
      }
    };

    const onRejection = (event: any) => {
      try {
        const err = event?.reason;
        const msg = String(err?.message || err || event);
        const stack = err?.stack ? "\n" + err.stack : "";
        console.error("UNHANDLED_REJECTION:", msg, err);
        setError(`UNHANDLED_REJECTION: ${msg}${stack}`);
      } catch (e) {
        console.error("UNHANDLED_REJECTION (handler failed):", e);
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const MAX_DIM = 1280;
  const JPEG_QUALITY = 0.82;

  const originalBytes = useMemo(
    () => (originalDataUrl ? dataUrlByteSize(originalDataUrl) : 0),
    [originalDataUrl]
  );
  const jpegBytes = useMemo(() => (jpegDataUrl ? dataUrlByteSize(jpegDataUrl) : 0), [jpegDataUrl]);

  const chosen = useMemo(() => {
    if (!originalDataUrl && !jpegDataUrl) return { label: "Ingen", dataUrl: "" };
    if (originalDataUrl && !jpegDataUrl) return { label: "Original", dataUrl: originalDataUrl };
    if (!originalDataUrl && jpegDataUrl) return { label: "Komprimeret", dataUrl: jpegDataUrl };
    if (originalBytes <= jpegBytes) return { label: "Original", dataUrl: originalDataUrl };
    return { label: "Komprimeret", dataUrl: jpegDataUrl };
  }, [originalDataUrl, jpegDataUrl, originalBytes, jpegBytes]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    setApiResult(null);

    const file = e.target.files?.[0];
    if (!file) {
      setPickedFileInfo(null);
      setOriginalDataUrl("");
      setJpegDataUrl("");
      setJpegDims(null);
      return;
    }

    setPickedFileInfo({ name: file.name, type: file.type || "(ukendt)", size: file.size });

    setBusy(true);
    try {
      const orig = await fileToDataUrl(file);
      setOriginalDataUrl(orig);

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

    if (!sanitizeDataUrl(chosen.dataUrl)) {
      setError("Vælg et billede først.");
      return;
    }

    setApiBusy(true);
    try {
      // API er nu robust, så vi sender kun én ting: image (dataURL)
      const res = await fetch("/api/fridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: sanitizeDataUrl(chosen.dataUrl), mode: "thorough" }),
      });

      const json = await res.json();

      if (!res.ok) {
        setApiResult({ ok: false, error: json?.error ?? `HTTP ${res.status}`, raw: json });
        return;
      }

      const items = extractItems(json);
      setApiResult({ ok: true, items, raw: json });
    } catch (err: any) {
      setApiResult({ ok: false, error: err?.message ?? "Netværksfejl.", raw: null });
    } finally {
      setApiBusy(false);
    }
  }

  const sortedItems =
    apiResult?.ok === true
      ? [...apiResult.items].sort((a, b) => {
          const ca = typeof a.confidence === "number" && Number.isFinite(a.confidence) ? a.confidence : -1;
          const cb = typeof b.confidence === "number" && Number.isFinite(b.confidence) ? b.confidence : -1;
          return cb - ca;
        })
      : [];

  return (
    <main
      style={{
        maxWidth: 920,
        margin: "40px auto",
        padding: "0 16px",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <style jsx global>{`
        .q-btn { transition: transform 90ms ease, filter 140ms ease, box-shadow 140ms ease; }
        .q-btn:hover:enabled { filter: brightness(1.06); box-shadow: 0 10px 26px rgba(0,0,0,0.18); transform: translateY(-1px); }
        .q-btn:active:enabled { filter: brightness(0.98); transform: translateY(0px) scale(0.99); }
        .q-btn:focus-visible { outline: 3px solid rgba(0,0,0,0.28); outline-offset: 2px; }
        .q-btn-primary:hover:enabled { filter: brightness(1.06); }
        .q-btn-secondary:hover:enabled { background: rgba(0,0,0,0.04); }
        .q-btn-secondary:active:enabled { background: rgba(0,0,0,0.06); }
      `}</style>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Qartigo - Fridge Scan</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Upload et billede. Appen vælger automatisk den mindste payload (Original dataURL vs downscaled JPEG)
        og sender kun den mindste til API’et.
      </p>

      
      <section
        style={{
          marginTop: 16,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div>
<section
        style={{
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 12,
          padding: 16,
          marginTop: 16,
        }}
      >
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Vælg billede</label>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onPickFile}
            style={{ position: "absolute", left: -99999, width: 1, height: 1, opacity: 0 }}
          />

          <button
            type="button"
            className="q-btn q-btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.18)",
              background: busy ? "rgba(0,0,0,0.06)" : "black",
              color: busy ? "rgba(0,0,0,0.5)" : "white",
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 800,
              letterSpacing: 0.2,
            }}
          >
            {pickedFileInfo ? "Skift billede" : "Upload foto"}
          </button>

          {pickedFileInfo ? (
            <button
              type="button"
              className="q-btn q-btn-secondary"
              onClick={() => {
                setPickedFileInfo(null);
                setOriginalDataUrl("");
                setJpegDataUrl("");
                setJpegDims(null);
                setApiResult(null);
                setError("");
              }}
              disabled={busy || apiBusy}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.18)",
                background: busy || apiBusy ? "rgba(0,0,0,0.06)" : "white",
                color: "black",
                cursor: busy || apiBusy ? "not-allowed" : "pointer",
                fontWeight: 800,
                letterSpacing: 0.2,
              }}
            >
              Fjern
            </button>
          ) : null}
        </div><div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
          <div>
            <strong>File:</strong>{" "}
            {pickedFileInfo
              ? `${pickedFileInfo.name} · ${pickedFileInfo.type} · ${formatBytes(pickedFileInfo.size)}`
              : "(ingen valgt endnu)"}
          </div>

          <div style={{ marginTop: 6 }}>
            <strong>Original:</strong> {originalDataUrl ? formatBytes(originalBytes) : "-"}
            {" · "}
            <strong>Komprimeret:</strong> {jpegDataUrl ? formatBytes(jpegBytes) : "-"}
            {jpegDims ? <span style={{ opacity: 0.75 }}> (ca. {jpegDims.w}x{jpegDims.h})</span> : null}
          </div>

          <div style={{ marginTop: 6 }}>
            <strong>Sendt til API:</strong> {chosen.label}
          </div>

          <div style={{ marginTop: 6 }}>
            <strong>Status:</strong> {busy ? "Behandler…" : "Idle"}
          </div>
        </div>

        {error ? <div style={{ marginTop: 10, color: "crimson" }}>{error}</div> : null}
      </section>

      <section
  style={{
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  }}
>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
    <div style={{ fontWeight: 700 }}>Preview (det billede der sendes)</div>

    <button
      className="q-btn"
      onClick={async () => {
  try {
    await callApi();
  } catch (e: any) {
    const msg = String(e?.message || e);
    const stack = e?.stack ? "\n" + e.stack : "";
    console.error("onClick caught:", msg, e);
    setError(`onClick caught: ${msg}${stack}`);
  }
}}
      disabled={apiBusy || busy || !sanitizeDataUrl(chosen.dataUrl)}
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.18)",
        background: apiBusy || busy || !sanitizeDataUrl(chosen.dataUrl) ? "rgba(0,0,0,0.06)" : "black",
        color: apiBusy || busy || !sanitizeDataUrl(chosen.dataUrl) ? "rgba(0,0,0,0.5)" : "white",
        cursor: apiBusy || busy || !sanitizeDataUrl(chosen.dataUrl) ? "not-allowed" : "pointer",
        fontWeight: 700,
      }}
    >
      {apiBusy ? "Analyserer…" : "Analyser billede"}
    </button>
  </div>

  <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "stretch" }}>
    <div
      style={{
        flex: "1 1 260px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.03)",
        border: "1px solid rgba(0,0,0,0.10)",
        padding: 12,
        minHeight: 280,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Analyse</div>
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        Grundig analyse (thorough). Finder flere ting (dyrere).
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
        <div>
          <strong>Sendt til API:</strong> {chosen.label}
        </div>
        <div style={{ marginTop: 6 }}>
          <strong>Status:</strong> {busy ? "Behandler…" : "Idle"}
        </div>
      </div>
    </div>

    <div
      style={{
        flex: "2 1 420px",
        borderRadius: 10,
        overflow: "hidden",
        background: "rgba(0,0,0,0.03)",
        border: "1px solid rgba(0,0,0,0.10)",
        height: 280,
        maxHeight: 280,
        padding: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {sanitizeDataUrl(chosen.dataUrl) ? (
        <img
          src={sanitizeDataUrl(chosen.dataUrl)}
          alt="Chosen preview"
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <div style={{ opacity: 0.6 }}>Ingen preview</div>
      )}
    </div>
  </div>

  {error ? <div style={{ marginTop: 10, color: "crimson" }}>{error}</div> : null}
</section>

<section
        style={{
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 12,
          padding: 16,
          marginTop: 16,
        }}
      >
        {apiResult?.ok === true ? (
          <div style={{ borderRadius: 10, padding: 12, background: "rgba(0, 128, 0, 0.08)" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Ingredienser</div>

            {sortedItems.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {sortedItems.map((it, idx) => {
                  const conf = fmtConfidence(it.confidence);
                  return (
                    <li key={idx}>
                      {it.name}
                      {conf ? <span style={{ opacity: 0.75 }}> {SHOW_RAW ? `(${conf})` : ""}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div style={{ opacity: 0.8 }}>Ingen ingredienser fundet.</div>
            )}

            {SHOW_RAW ? (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer" }}>Rå API-respons (kun i dev)</summary>
                <pre style={{ marginTop: 10, fontSize: 12, opacity: 0.85, whiteSpace: "pre-wrap" }}>
{JSON.stringify(apiResult.raw ?? {}, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ) : apiResult?.ok === false ? (
          <div style={{ borderRadius: 10, padding: 12, background: "rgba(220, 20, 60, 0.10)" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Fejl</div>
            <div>{apiResult.error}</div>
            {SHOW_RAW ? (
              <pre style={{ marginTop: 10, fontSize: 12, opacity: 0.85, whiteSpace: "pre-wrap" }}>
{JSON.stringify(apiResult.raw ?? {}, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : (
          <div style={{ opacity: 0.75 }}>Ingen analyse endnu.</div>
        )}
      </section>
          </div>
        </div>
      </section>


      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.7 }}>
        Note: Hvis originalen er en lille WEBP, kan JPEG-varianten blive større. Derfor vælges altid den mindste payload automatisk.
      </div>
    </main>
  );
}

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type ApiItem = { name: string; confidence?: number; kind?: string; contents?: string };
type ApiOk = { ok: true; items: ApiItem[]; raw?: any };
type ApiErr = { ok: false; error: string; raw?: any; detail?: any };
type ApiResult = ApiOk | ApiErr;

function stripWhitespace(s: string) {
  return (s ?? "").trim().replace(/\s+/g, "");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

function dataUrlByteSize(dataUrl: string): number {
  const t = (dataUrl ?? "").trim();
  const comma = t.indexOf(",");
  if (comma === -1) return 0;
  const b64 = t.slice(comma + 1);
  // approx bytes = 3/4 * len - padding
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((3 * b64.length) / 4) - pad;
}

function base64FromBytes(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] + "=" : "==";
  }
  return out;
}

async function fileToDataUrl(file: File): Promise<string> {
  // Safari-stabil: ingen FileReader.readAsDataURL; vi bygger selv dataURL fra bytes
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const b64 = base64FromBytes(bytes);
  const type = file.type && file.type.includes("/") ? file.type : "application/octet-stream";
  return `data:${type};base64,${b64}`;
}

async function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality = 0.82): Promise<string> {
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
        "image/jpeg",
        quality
      );
    });
    const buf = await blob.arrayBuffer();
    const b64 = base64FromBytes(new Uint8Array(buf));
    return `data:image/jpeg;base64,${b64}`;
  } catch (e) {
    console.error("canvasToJpegDataUrl failed:", e);
    return "";
  }
}

async function downscaleToJpegDataUrl(file: File, opts: { maxDim: number; quality: number }) {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    const url = URL.createObjectURL(file);

    el.onload = () => {
      try { URL.revokeObjectURL(url); } catch {}
      resolve(el);
    };

    el.onerror = () => {
      try { URL.revokeObjectURL(url); } catch {}
      reject(new Error("Kunne ikke indlæse fil i <img> via objectURL (image decode fejl)."));
    };

    try {
      el.src = url;
    } catch (e) {
      try { URL.revokeObjectURL(url); } catch {}
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

function formatErr(e: any): string {
  try {
    if (typeof e === "string") return e;
    const name = e?.name ? String(e.name) : "Error";
    const msg = e?.message ? String(e.message) : String(e);
    const code = e?.code != null ? `\ncode: ${String(e.code)}` : "";
    const stack = e?.stack ? `\n${String(e.stack)}` : "";
    const keys =
      !stack && e && typeof e === "object" ? `\nkeys: ${Object.keys(e).join(", ")}` : "";
    return `${name}: ${msg}${code}${stack}${keys}`;
  } catch {
    return String(e);
  }
}

export default function Page() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [pickedInfo, setPickedInfo] = useState<{ name: string; type: string; size: number } | null>(null);
  const [originalDataUrl, setOriginalDataUrl] = useState("");
  const [jpegDataUrl, setJpegDataUrl] = useState("");
  const [jpegDims, setJpegDims] = useState<{ w: number; h: number } | null>(null);

  const [busy, setBusy] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiResult, setApiResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState("");

  // Global error catcher (Safari giver ellers kun "The string did not match the expected pattern.")
  useEffect(() => {
    const onError = (ev: any) => {
      try {
        const loc = ev?.filename ? ` @ ${ev.filename}:${ev.lineno ?? "?"}:${ev.colno ?? "?"}` : "";
        const msg = (ev?.message || String(ev?.error?.message || ev?.error || ev)) + loc;
        const stack = ev?.error?.stack ? "\n" + ev.error.stack : "";
        console.error("GLOBAL_ERROR:", msg, ev?.error);
        setError(`GLOBAL_ERROR: ${msg}${stack}`);
      } catch (e) {
        console.error("GLOBAL_ERROR (handler failed):", e);
      }
    };

    const onRejection = (ev: any) => {
      try {
        const reason = ev?.reason;
        const msg = String(reason?.message || reason || ev);
        const stack = reason?.stack ? "\n" + reason.stack : "";
        console.error("UNHANDLED_REJECTION:", msg, reason);
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

  const originalBytes = useMemo(() => (originalDataUrl ? dataUrlByteSize(originalDataUrl) : 0), [originalDataUrl]);
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
      setPickedInfo(null);
      setOriginalDataUrl("");
      setJpegDataUrl("");
      setJpegDims(null);
      return;
    }

    setPickedInfo({ name: file.name, type: file.type || "(ukendt)", size: file.size });

    setBusy(true);
    try {
      const orig = await fileToDataUrl(file);
      setOriginalDataUrl(orig);

      try {
        const { jpegDataUrl: jpg, width, height } = await downscaleToJpegDataUrl(file, {
          maxDim: MAX_DIM,
          quality: JPEG_QUALITY,
        });
        setJpegDataUrl(jpg);
        setJpegDims({ w: width, h: height });
      } catch (err) {
        console.warn("Downscale/preview failed; using originalDataUrl:", err);
        setJpegDataUrl("");
        setJpegDims(null);
      }
    } catch (err) {
      setError(formatErr(err));
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
        setApiResult({ ok: false, error: json?.error ?? `HTTP ${res.status}`, raw: json });
        return;
      }

      const items: ApiItem[] = Array.isArray(json?.items)
        ? json.items.map((it: any) => ({
            name: String(it?.name ?? "").trim(),
            confidence: typeof it?.confidence === "number" ? it.confidence : undefined,
            kind: typeof it?.kind === "string" ? it.kind : undefined,
            contents: typeof it?.contents === "string" ? it.contents : undefined,
          })).filter((it: ApiItem) => it.name.length > 0)
        : [];

      setApiResult({ ok: true, items, raw: json?.raw ?? json });
    } catch (err: any) {
      setApiResult({ ok: false, error: err?.message ?? "Netværksfejl.", raw: null });
    } finally {
      setApiBusy(false);
    }
  }

  const sortedItems = useMemo(() => {
    if (!apiResult || apiResult.ok !== true) return [];
    const copy = [...apiResult.items];
    copy.sort((a, b) => {
      const ac = typeof a.confidence === "number" && Number.isFinite(a.confidence) ? a.confidence : -1;
      const bc = typeof b.confidence === "number" && Number.isFinite(b.confidence) ? b.confidence : -1;
      return bc - ac;
    });
    return copy;
  }, [apiResult]);

  return (
    <main className="wrap">
      <style>{css}</style>

      <header className="top">
        <div>
          <div className="kicker">Qartigo</div>
          <h1 className="h1">Fridge Scan</h1>
          <p className="sub">
            Upload et billede. Appen vælger automatisk den mindste payload (Original dataURL vs downscaled JPEG) og sender kun den mindste til API’et.
          </p>
        </div>
        <div className="pill">
          <span className="dot" />
          <span>{apiBusy ? "Analyserer…" : busy ? "Forbereder…" : "Klar"}</span>
        </div>
      </header>

      {error ? (
        <div className="alert alert-err">
          <div className="alertTitle">Fejl</div>
          <pre className="pre">{error}</pre>
        </div>
      ) : null}

      <section className="grid">
        {/* LEFT: Upload + Preview */}
        <div className="col">
          <div className="card">
            <div className="cardHead">
              <div>
                <div className="cardTitle">Billede</div>
                <div className="cardHint">Vælg et foto fra din enhed</div>
              </div>

              <div className="actions">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onPickFile}
                  className="hiddenInput"
                />
                <button
                  className="btn btn-secondary"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy || apiBusy}
                >
                  Vælg billede
                </button>

                <button
                  className="btn btn-primary"
                  onClick={callApi}
                  disabled={apiBusy || busy || !chosen.dataUrl}
                >
                  {apiBusy ? "Analyserer…" : "Analyser billede"}
                </button>
              </div>
            </div>

            <div className="meta">
              <div className="metaRow">
                <div className="metaKey">Fil</div>
                <div className="metaVal">
                  {pickedInfo ? (
                    <span className="mono">
                      {pickedInfo.name} • {pickedInfo.type} • {formatBytes(pickedInfo.size)}
                    </span>
                  ) : (
                    <span className="muted">Ingen fil valgt</span>
                  )}
                </div>
              </div>

              <div className="metaRow">
                <div className="metaKey">Payload</div>
                <div className="metaVal">
                  <div className="chips">
                    <span className="chip">
                      Original: <span className="mono">{formatBytes(originalBytes)}</span>
                    </span>
                    <span className="chip">
                      JPEG: <span className="mono">{formatBytes(jpegBytes)}</span>
                      {jpegDims ? <span className="muted"> • {jpegDims.w}×{jpegDims.h}</span> : null}
                    </span>
                    <span className="chip chip-strong">
                      Sendt: <span className="mono">{chosen.label}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="previewWrap">
              {chosen.dataUrl ? (
                <img className="previewImg" src={chosen.dataUrl} alt="Chosen preview" />
              ) : (
                <div className="previewEmpty">Ingen preview</div>
              )}
            </div>

            <div className="footerNote">
              Tip: hvis billedet er mørkt/rodet, bliver output mere usikkert. Beskæring hjælper.
            </div>
          </div>
        </div>

        {/* RIGHT: Results */}
        <div className="col">
          <div className="card">
            <div className="cardHead">
              <div>
                <div className="cardTitle">Analyse</div>
                <div className="cardHint">Ingredienser + beholdere/emballage fra scenen</div>
              </div>
            </div>

            {!apiResult ? (
              <div className="emptyState">
                <div className="emptyTitle">Ingen analyse endnu</div>
                <div className="emptyText">Vælg et billede og tryk “Analyser billede”.</div>
              </div>
            ) : apiResult.ok === false ? (
              <div className="alert alert-err">
                <div className="alertTitle">{apiResult.error}</div>
                {apiResult.raw ? <pre className="pre">{JSON.stringify(apiResult.raw, null, 2)}</pre> : null}
              </div>
            ) : (
              <>
                <div className="resultSummary">
                  <div className="count">
                    Fundet <span className="mono">{sortedItems.length}</span> items
                  </div>
                  <div className="muted">Sorterede efter confidence</div>
                </div>

                {sortedItems.length ? (
                  <ul className="list">
                    {sortedItems.map((it, idx) => {
                      const conf = fmtConfidence(it.confidence);
                      const kind = it.kind ? String(it.kind) : "";
                      const contents = it.contents ? String(it.contents) : "";
                      return (
                        <li className="row" key={idx}>
                          <div className="rowMain">
                            <div className="rowName">{it.name}</div>
                            <div className="rowTags">
                              {kind ? <span className="tag">{kind}</span> : null}
                              {contents ? <span className="tag tag-soft">contents: {contents}</span> : null}
                            </div>
                          </div>
                          <div className="rowRight">
                            {conf ? <span className="badge">{conf}</span> : <span className="badge badge-soft">—</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="emptyState">
                    <div className="emptyTitle">Ingen items</div>
                    <div className="emptyText">Prøv et skarpere/beskåret billede.</div>
                  </div>
                )}

                <details className="details">
                  <summary>Vis rå JSON</summary>
                  <pre className="pre">{JSON.stringify(apiResult.raw, null, 2)}</pre>
                </details>
              </>
            )}
          </div>
        </div>
      </section>

      <footer className="bottom">
        <div className="muted">
          /api/fridge • sender altid thorough • viser altid mindste payload
        </div>
      </footer>
    </main>
  );
}

const css = `
:root {
  --bg: #0b0c10;
  --card: rgba(255,255,255,0.06);
  --card2: rgba(255,255,255,0.045);
  --stroke: rgba(255,255,255,0.10);
  --stroke2: rgba(255,255,255,0.14);
  --text: rgba(255,255,255,0.92);
  --muted: rgba(255,255,255,0.62);
  --muted2: rgba(255,255,255,0.50);
  --shadow: 0 18px 60px rgba(0,0,0,0.55);
  --radius: 18px;
  --radius2: 14px;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6f7fb;
    --card: rgba(255,255,255,0.92);
    --card2: rgba(0,0,0,0.03);
    --stroke: rgba(0,0,0,0.08);
    --stroke2: rgba(0,0,0,0.12);
    --text: rgba(0,0,0,0.86);
    --muted: rgba(0,0,0,0.60);
    --muted2: rgba(0,0,0,0.50);
    --shadow: 0 18px 60px rgba(0,0,0,0.10);
  }
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; font-family: var(--sans); background: radial-gradient(1200px 800px at 20% 0%, rgba(122,92,255,0.16), transparent 55%),
                                     radial-gradient(1000px 600px at 90% 10%, rgba(0,200,255,0.12), transparent 50%),
                                     var(--bg);
       color: var(--text); }

.wrap { max-width: 1120px; margin: 38px auto; padding: 0 18px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
.kicker { letter-spacing: 0.12em; text-transform: uppercase; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
.h1 { font-size: 34px; line-height: 1.12; margin: 0 0 10px 0; }
.sub { margin: 0; color: var(--muted); max-width: 780px; }
.pill { display: inline-flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 999px; border: 1px solid var(--stroke); background: var(--card); box-shadow: var(--shadow); }
.dot { width: 10px; height: 10px; border-radius: 999px; background: rgba(0,255,170,0.9); box-shadow: 0 0 0 4px rgba(0,255,170,0.16); }

.grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 16px; align-items: start; }
@media (max-width: 980px) { .grid { grid-template-columns: 1fr; } .pill { display: none; } }

.card { border: 1px solid var(--stroke); background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.cardHead { padding: 16px 16px 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--stroke); }
.cardTitle { font-weight: 750; font-size: 16px; }
.cardHint { margin-top: 4px; font-size: 12px; color: var(--muted); }

.actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.hiddenInput { position: absolute; left: -99999px; width: 1px; height: 1px; opacity: 0; }

.btn { border-radius: 12px; padding: 10px 14px; font-weight: 700; border: 1px solid var(--stroke2); cursor: pointer; transition: transform .08s ease, filter .12s ease, background .12s ease, border-color .12s ease; }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn-primary { background: rgba(255,255,255,0.94); color: rgba(0,0,0,0.92); }
.btn-secondary { background: transparent; color: var(--text); }
.btn:hover:enabled { filter: brightness(1.03); transform: translateY(-1px); }
.btn:active:enabled { transform: translateY(0px); }

.meta { padding: 14px 16px 0 16px; }
.metaRow { display: grid; grid-template-columns: 86px 1fr; gap: 12px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.00); }
.metaRow + .metaRow { border-top: 1px solid rgba(0,0,0,0.0); }
.metaKey { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.10em; padding-top: 3px; }
.metaVal { font-size: 14px; }
.muted { color: var(--muted); }
.mono { font-family: var(--mono); }

.chips { display: flex; gap: 10px; flex-wrap: wrap; }
.chip { border: 1px solid var(--stroke); background: var(--card2); padding: 8px 10px; border-radius: 999px; font-size: 12px; color: var(--muted); }
.chip-strong { color: var(--text); border-color: var(--stroke2); }

.previewWrap { margin: 14px 16px 10px 16px; border-radius: var(--radius2); border: 1px solid var(--stroke); background: var(--card2); height: 340px; display: grid; place-items: center; overflow: hidden; }
.previewImg { width: 100%; height: 100%; object-fit: contain; display: block; }
.previewEmpty { color: var(--muted); font-size: 13px; }

.footerNote { padding: 0 16px 14px 16px; color: var(--muted2); font-size: 12px; }

.alert { margin: 14px 0; border-radius: var(--radius); border: 1px solid var(--stroke); padding: 14px 16px; background: var(--card); box-shadow: var(--shadow); }
.alert-err { border-color: rgba(255, 90, 90, 0.35); }
.alertTitle { font-weight: 800; margin-bottom: 8px; }
.pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 12px; color: var(--muted); }

.emptyState { padding: 22px 16px; }
.emptyTitle { font-weight: 800; margin-bottom: 6px; }
.emptyText { color: var(--muted); font-size: 13px; }

.resultSummary { padding: 14px 16px 0 16px; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.count { font-weight: 800; }
.list { list-style: none; margin: 12px 0 0 0; padding: 0; }
.row { padding: 12px 16px; border-top: 1px solid var(--stroke); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.rowMain { min-width: 0; }
.rowName { font-weight: 760; }
.rowTags { margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap; }
.tag { font-size: 12px; color: var(--text); border: 1px solid var(--stroke); background: var(--card2); padding: 5px 8px; border-radius: 999px; }
.tag-soft { color: var(--muted); }
.rowRight { flex: 0 0 auto; }
.badge { font-family: var(--mono); font-size: 12px; padding: 7px 9px; border-radius: 999px; border: 1px solid var(--stroke2); background: rgba(0,0,0,0.10); }
@media (prefers-color-scheme: light) {
  .badge { background: rgba(0,0,0,0.03); }
}
.badge-soft { color: var(--muted); border-color: var(--stroke); }

.details { margin: 14px 16px 16px 16px; border-top: 1px solid var(--stroke); padding-top: 12px; }
.details summary { cursor: pointer; color: var(--muted); font-weight: 700; }
.details[open] summary { margin-bottom: 10px; }

.bottom { margin-top: 16px; padding: 8px 2px 22px 2px; }
`;

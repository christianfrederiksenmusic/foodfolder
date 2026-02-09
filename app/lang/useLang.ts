"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANGS, t as tRaw } from "../i18n";
import type { TKey } from "../i18n";
import type { Lang } from "./types";
import { MARKET_LANG } from "./types";
import { getUiLang, setUiLang as persistUiLang } from "./storage";
import { splitItems } from "./split";
import { translateItems, translateMap } from "./translate";

function normalizeItem(s: string) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function dedupeCaseInsensitive(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const v = normalizeItem(x);
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export type LangRuntime = {
  uiLang: Lang;
  setUiLang: (lang: Lang) => void;
  marketLang: Lang;
  dir: "ltr" | "rtl";
  tt: (key: TKey, vars?: Record<string, string | number | null | undefined>) => string;
  displayNameFor: (canonicalDa: string) => string;
  ensureDaCanonical: (rawInput: string) => Promise<string[]>;
  ensureDaCanonicalList: (items: string[]) => Promise<string[]>;
};

// Central language runtime:
// - uiLang controls UI strings
// - marketLang is always Danish, for offer queries/matching
// - canonical items are always stored as Danish strings
// - optional display translations cached per uiLang
export function useLangRuntime(canonicalDaItems: string[] = []): LangRuntime {
  const [uiLang, _setUiLang] = useState<Lang>("da");

  // UI-only translations (da canonical -> display for uiLang)
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const lastKeyRef = useRef<string>("");

  // Load saved uiLang once.
  useEffect(() => {
    _setUiLang(getUiLang());
  });

  const setUiLang = (lang: Lang) => {
    _setUiLang(lang);
    persistUiLang(lang);
  };

  const dir = useMemo(() => {
    return LANGS.find((x) => x.code === uiLang)?.dir ?? "ltr";
  }, [uiLang]);

  const tt = (key: TKey, vars?: Record<string, any>) => {
    const s = tRaw(uiLang, key);
    if (!vars) return s;
    return s.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, k) => {
      const v = (vars as any)[k];
      return (v === undefined || v === null) ? `{${k}}` : String(v);
    });
  };

  const canonicalKey = useMemo(() => {
    const uniq = dedupeCaseInsensitive(canonicalDaItems);
    return uniq.join("\n");
  }, [canonicalDaItems]);

  // Refresh display translations whenever uiLang changes or canonical list changes.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (uiLang === MARKET_LANG) {
        setTranslations({});
        lastKeyRef.current = "";
        return;
      }

      const uniq = dedupeCaseInsensitive(canonicalDaItems);
      if (!uniq.length) {
        setTranslations({});
        lastKeyRef.current = "";
        return;
      }

      const key = `${uiLang}::${uniq.join("|")}`;
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;

      try {
        const map = await translateMap(uniq, uiLang);
        if (!cancelled) setTranslations(map);
      } catch {
        if (!cancelled) setTranslations({});
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [uiLang, canonicalKey]);

  const displayNameFor = (canonicalDa: string): string => {
    const c = normalizeItem(canonicalDa);
    if (!c) return "";
    if (uiLang === MARKET_LANG) return c;
    return translations[c] ?? c;
  };

  const ensureDaCanonical = async (rawInput: string): Promise<string[]> => {
    const parts = splitItems(rawInput).map(normalizeItem).filter(Boolean);
    if (!parts.length) return [];

    if (uiLang === MARKET_LANG) return dedupeCaseInsensitive(parts);

    // Translate each part to Danish canonical.
    const da = await translateItems(parts, MARKET_LANG);
    return dedupeCaseInsensitive(da);
  };

  const ensureDaCanonicalList = async (items: string[]): Promise<string[]> => {
    const clean = dedupeCaseInsensitive((items || []).map(normalizeItem).filter(Boolean));
    if (!clean.length) return [];
    if (uiLang === MARKET_LANG) return clean;
    const da = await translateItems(clean, MARKET_LANG);
    return dedupeCaseInsensitive(da);
  };

  return {
    uiLang,
    setUiLang,
    marketLang: MARKET_LANG,
    dir,
    tt,
    displayNameFor,
    ensureDaCanonical,
    ensureDaCanonicalList,
  };
}

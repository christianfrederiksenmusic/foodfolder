"use client";

import type { Lang } from "./types";
import { LANGS } from "../i18n";

const KEY = "ff_lang";

export function getUiLang(): Lang {
  try {
    const saved = (localStorage.getItem(KEY) || "") as Lang;
    if (saved && LANGS.some((x) => x.code === saved)) return saved;
  } catch {
    // ignore
  }
  return "da";
}

export function setUiLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // ignore
  }
}

"use client";

import { useEffect, useState } from "react";
import { Lang, t } from "../i18n";
import PantryClient from "./pantry-client";

export default function PantryPage() {
  const [lang, setLang] = useState<Lang>("da");

  useEffect(() => {
    try {
      const saved = (localStorage.getItem("ff_lang") || "da") as Lang;
      setLang(saved);
    } catch {}
  }, []);
return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">{t(lang, "pantry_page_title")}</h1>
        <p className="mt-2 text-sm text-slate-600">{t(lang, "pantry_page_desc")}</p>
      </div>

      <PantryClient lang={lang} />
    </main>
  );
}

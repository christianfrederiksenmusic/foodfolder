import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type CookbookRecipeRow = {
  id: string | number;
  title: string | null;
  created_at: string | null;
  // gemmer fleksibelt - nogle rækker kan have recipe som objekt/JSON
  recipe?: any;
};

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("da-DK", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "";
  }
}

function safeStr(v: any) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default async function CookbookPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data, error } = await supabase
    .from("cookbook_entries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-white via-white to-slate-50"></div>
          <div className="absolute -top-40 left-[-10%] h-[520px] w-[520px] rounded-full bg-blue-200/35 blur-3xl"></div>
          <div className="absolute -top-24 right-[-10%] h-[520px] w-[520px] rounded-full bg-emerald-200/30 blur-3xl"></div>
        </div>

        <div className="mx-auto max-w-6xl px-5 py-10">
          <header className="mb-8 grid grid-cols-3 items-center gap-4">
            <div className="justify-self-start">
              <Link
                href="/"
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm backdrop-blur hover:bg-white"
              >
                Tilbage
              </Link>
            </div>

            <div className="justify-self-center text-center">
              <div className="text-xs font-semibold tracking-[0.18em] text-slate-500">
                Quartigo
              </div>
              <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-900">
                Min kogebog
              </h1>
              <p className="mt-2 text-sm text-slate-700">
                Noget gik galt da opskrifterne skulle hentes.
              </p>
            </div>

            <div className="justify-self-end" />
          </header>

          <div className="rounded-3xl border border-rose-200 bg-white/80 p-6 shadow-sm backdrop-blur">
            <div className="text-sm font-semibold text-slate-900">Database-fejl</div>
            <pre className="mt-3 overflow-auto rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-900">
{safeStr(error)}
            </pre>
          </div>
        </div>
      </main>
    );
  }

  const recipes = (data ?? []) as CookbookRecipeRow[];

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-white to-slate-50"></div>
        <div className="absolute -top-40 left-[-10%] h-[520px] w-[520px] rounded-full bg-blue-200/35 blur-3xl"></div>
        <div className="absolute -top-24 right-[-10%] h-[520px] w-[520px] rounded-full bg-emerald-200/30 blur-3xl"></div>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="mb-8 grid grid-cols-3 items-center gap-4">
          <div className="justify-self-start">
            <Link
              href="/"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm backdrop-blur hover:bg-white"
            >
              Tilbage
            </Link>
          </div>

          <div className="justify-self-center text-center">
            <div className="text-xs font-semibold tracking-[0.18em] text-slate-500">
              Quartigo
            </div>
            <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-900">
              Min kogebog
            </h1>
            <p className="mt-2 text-sm text-slate-700">
              Gemte opskrifter - fold dem ud som faner.
            </p>
          </div>

          <div className="justify-self-end">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 shadow-sm backdrop-blur">
              <span className="text-sm font-medium text-slate-800">
                {recipes.length} opskrifter
              </span>
            </div>
          </div>
        </header>

        {recipes.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-sm backdrop-blur">
            <div className="text-base font-semibold text-slate-900">
              Ingen opskrifter endnu
            </div>
            <p className="mt-2 text-sm text-slate-700">
              Når du gemmer en opskrift, lander den her.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {recipes.map((r) => {
              const id = String(r.id);
              const body = r.recipe ?? r;
              const rec = body && typeof body === "object" ? (body as any) : null;
              const title =
                (String((r.title ?? rec?.title ?? "Uden titel") ?? "Uden titel").trim() ||
                  "Uden titel");
              const created = fmtDate(r.created_at);

              async function deleteRecipe() {
                "use server";
                const supabase = await createClient();
                await supabase.from("cookbook_entries").delete().eq("id", id);
                redirect("/cookbook");
              }

              return (
                <details
                  key={id}
                  className="group rounded-3xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur open:bg-white"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-slate-900">
                        {title}
                      </div>
                      <div className="mt-1 text-sm text-slate-700">
                        {created ? `Gemt: ${created}` : "Gemt"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900">
                        Åbn
                      </div>

                      <form action={deleteRecipe}>
                        <button
                          type="submit"
                          className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          Slet
                        </button>
                      </form>
                    </div>
                  </summary>

                  <div className="border-t border-slate-200 px-6 py-6">
                    {rec ? (
                      <div className="space-y-5">
                        {rec.summary ? (
                          <div className="text-sm text-slate-700">{rec.summary}</div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          {typeof rec.totalTimeMinutes === "number" ? (
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800">
                              Total: {rec.totalTimeMinutes} min
                            </span>
                          ) : null}
                          {typeof rec.prepTimeMinutes === "number" ? (
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800">
                              Prep: {rec.prepTimeMinutes} min
                            </span>
                          ) : null}
                          {typeof rec.cookTimeMinutes === "number" ? (
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800">
                              Cook: {rec.cookTimeMinutes} min
                            </span>
                          ) : null}
                          {typeof rec.servings === "number" ? (
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800">
                              {rec.servings} portioner
                            </span>
                          ) : null}
                          {rec.sourceType ? (
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800">
                              Kilde: {String(rec.sourceType)}
                            </span>
                          ) : null}
                        </div>

                        {Array.isArray(rec.tags) && rec.tags.length ? (
                          <div className="flex flex-wrap gap-2">
                            {rec.tags.map((t: any, idx: number) => (
                              <span
                                key={idx}
                                className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-sm text-emerald-900"
                              >
                                {String(t)}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {Array.isArray(rec.ingredients) && rec.ingredients.length ? (
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              Ingredienser
                            </div>
                            <ul className="mt-2 space-y-2">
                              {rec.ingredients.map((ing: any, idx: number) => {
                                const item = ing?.item != null ? String(ing.item) : "";
                                const amount = ing?.amount != null ? String(ing.amount) : "";
                                const line =
                                  (amount && item) ? `${amount} - ${item}` : (item || amount);
                                return (
                                  <li
                                    key={idx}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
                                  >
                                    {line || safeStr(ing)}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}

                        {Array.isArray(rec.steps) && rec.steps.length ? (
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              Fremgangsmåde
                            </div>
                            <ol className="mt-2 space-y-2">
                              {rec.steps.map((st: any, idx: number) => (
                                <li
                                  key={idx}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
                                >
                                  <span className="mr-2 font-semibold text-slate-900">
                                    {idx + 1}.
                                  </span>
                                  {String(st)}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null}

                        {Array.isArray(rec.tips) && rec.tips.length ? (
                          <div>
                            <div className="text-sm font-semibold text-slate-900">Tips</div>
                            <ul className="mt-2 space-y-2">
                              {rec.tips.map((t: any, idx: number) => (
                                <li
                                  key={idx}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
                                >
                                  {String(t)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {Array.isArray(rec.missing_items) && rec.missing_items.length ? (
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              Mangler
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {rec.missing_items.map((m: any, idx: number) => (
                                <span
                                  key={idx}
                                  className="rounded-full border border-rose-200 bg-white px-3 py-1 text-sm text-rose-800"
                                >
                                  {String(m)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                      </div>
                    ) : (
                      <pre className="overflow-auto rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-900">
{safeStr(body)}
                      </pre>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

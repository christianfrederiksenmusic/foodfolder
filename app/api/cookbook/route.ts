import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CookbookRecipeSnapshot } from "@/app/types/cookbook";

type DbCookbookRow = {
  id: string;
  user_id: string;
  recipe: CookbookRecipeSnapshot;
  image_url: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

/**
 * Accepts both:
 * - new "full snapshot" shape (summary/timeMinutes/tags/missing_items)
 * - legacy shape (description/prepTimeMinutes/cookTimeMinutes/totalTimeMinutes)
 *
 * Goal: don't break old entries, but enforce enough structure to avoid garbage writes.
 */
function isRecipeSnapshot(value: unknown): value is CookbookRecipeSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.title)) return false;
  if (v.sourceType !== "ai") return false;

  if (!Array.isArray(v.ingredients) || v.ingredients.length < 3) return false;
  if (!Array.isArray(v.steps) || v.steps.length < 3) return false;

  const ingredientsOk = v.ingredients.every((ing) => {
    if (!ing || typeof ing !== "object") return false;
    const i = ing as Record<string, unknown>;
    if (!isNonEmptyString(i.item)) return false;
    if (i.amount !== undefined && typeof i.amount !== "string") return false;
    return true;
  });

  const stepsOk = v.steps.every((s) => isNonEmptyString(s));

  if (!ingredientsOk || !stepsOk) return false;

  // Optional fields validation (soft)
  if (v.summary !== undefined && typeof v.summary !== "string") return false;
  if (v.description !== undefined && typeof v.description !== "string") return false;

  if (v.servings !== undefined && typeof v.servings !== "number") return false;

  if (v.timeMinutes !== undefined && typeof v.timeMinutes !== "number") return false;
  if (v.prepTimeMinutes !== undefined && typeof v.prepTimeMinutes !== "number") return false;
  if (v.cookTimeMinutes !== undefined && typeof v.cookTimeMinutes !== "number") return false;
  if (v.totalTimeMinutes !== undefined && typeof v.totalTimeMinutes !== "number") return false;

  if (v.tags !== undefined && !isStringArray(v.tags)) return false;
  if (v.missing_items !== undefined && !isStringArray(v.missing_items)) return false;
  if (v.tips !== undefined && !isStringArray(v.tips)) return false;

  if (v.generatedAt !== undefined && typeof v.generatedAt !== "string") return false;

  return true;
}

function mapRow(row: DbCookbookRow) {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recipe: row.recipe,
    imageUrl: row.image_url,
    isArchived: row.is_archived,
  };
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("cookbook_entries")
    .select("id,user_id,recipe,image_url,is_archived,created_at,updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load cookbook entries", details: error.message },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as DbCookbookRow[];
  return NextResponse.json({ entries: rows.map(mapRow) });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recipe = (body as { recipe?: unknown })?.recipe;

  if (!isRecipeSnapshot(recipe)) {
    return NextResponse.json(
      { error: "Invalid recipe payload. Expected { recipe: CookbookRecipeSnapshot }" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("cookbook_entries")
    .insert({
      user_id: user.id,
      recipe,
    })
    .select("id,user_id,recipe,image_url,is_archived,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to save cookbook entry", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ entry: mapRow(data as DbCookbookRow) }, { status: 201 });
}

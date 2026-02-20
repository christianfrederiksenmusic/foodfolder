export type CookbookIngredient = {
  item: string;
  /**
   * Amount is kept as free text because the AI may output ranges,
   * mixed units, or "to taste".
   * Example: "2 dl", "1 spsk", "200 g", "Efter smag"
   */
  amount?: string;
};

export type CookbookRecipeSnapshot = {
  // Core
  title: string;

  /**
   * Legacy field kept for backwards compatibility.
   * Prefer `summary` going forward.
   */
  description?: string;

  /**
   * Preferred short description/summary of the recipe.
   * Mirrors recipes API: `summary`.
   */
  summary?: string;

  servings?: number;

  /**
   * Legacy time fields kept for backwards compatibility.
   */
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;

  /**
   * Preferred unified time field (mirrors recipes API: `time_minutes`).
   */
  timeMinutes?: number;

  ingredients: CookbookIngredient[];
  steps: string[];

  /**
   * Optional extras
   */
  tips?: string[];
  tags?: string[];

  /**
   * Items the recipe needs but were NOT available in fridge/pantry at generation time.
   * Mirrors recipes API: `missing_items`.
   */
  missing_items?: string[];

  sourceType: "ai";
  generatedAt?: string;
};

export type CookbookEntry = {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  recipe: CookbookRecipeSnapshot;
  imageUrl?: string | null;
  isArchived?: boolean;
};

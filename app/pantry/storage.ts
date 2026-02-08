"use client";
export const PANTRY_STORAGE_KEY = "quartigo_pantry_v1";
export function loadPantryValues(): string[] {
  try {
    const raw = localStorage.getItem(PANTRY_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}
export function savePantryValues(values: string[]) {
  localStorage.setItem(PANTRY_STORAGE_KEY, JSON.stringify(values));
}

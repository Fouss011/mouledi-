import { matchDistrict } from "./matchDistrict";

export type Intent = "PHARMACY_ON_CALL" | "PHARMACY" | "CLINIC" | "UNKNOWN";

export function normalizeText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "'");
}

export function detectIntent(text: string): Intent {
  const t = normalizeText(text);

  const hasPharmacy = t.includes("pharmacie") || t.includes("pharmacies");
  const hasClinic =
    t.includes("clinique") ||
    t.includes("cliniques") ||
    t.includes("centre de sante") ||
    t.includes("centre de santé") ||
    t.includes("hopital") ||
    t.includes("hôpital");

  const hasOnCall =
    t.includes("garde") || t.includes("de garde") || t.includes("garda") || t.includes("on call");

  if (hasPharmacy && hasOnCall) return "PHARMACY_ON_CALL";
  if (hasPharmacy) return "PHARMACY";

  if (hasClinic) return "CLINIC";

  return "UNKNOWN";
}

export function extractDistrict(text: string): string | null {
  return matchDistrict(text);
}

export function routeQuery(text: string): { intent: Intent; district: string | null } {
  const intent = detectIntent(text);
  const district = extractDistrict(text);
  return { intent, district };
}
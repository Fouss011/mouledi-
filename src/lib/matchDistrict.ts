import { DISTRICT_ALIASES, District } from "./districts";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function matchDistrict(text: string): District | null {
  const t = norm(text);

  // 1) match exact d'un mot dans la phrase
  const parts = t.split(" ");
  for (const p of parts) {
    const d = DISTRICT_ALIASES[p];
    if (d) return d;
  }

  // 2) match "contains" (utile si whisper colle des mots)
  for (const k of Object.keys(DISTRICT_ALIASES)) {
    if (t.includes(k)) return DISTRICT_ALIASES[k];
  }

  return null;
}

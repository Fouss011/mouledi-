export type RoutedIntent =
  | "PHARMACY"
  | "CLINIC"
  | "PHARMACY_ON_CALL"
  | "RESTAURANT"
  | "ADMIN_GUIDE"
  | "UNKNOWN";

export type AdminGuideKey = "passport" | "cni" | "casier" | null;

export type RouteQueryResult = {
  intent: RoutedIntent;
  district: string | null;
  adminKey?: AdminGuideKey;
};

const DISTRICT_ALIASES: Record<string, string> = {
  be: "bè",
  "bè": "bè",
  agoe: "agoè",
  "agoè": "agoè",
  agwe: "agoè",
  tokoin: "tokoin",
  adidogome: "adidogomé",
  "adidogomé": "adidogomé",
  nyekonakpoe: "nyekonakpoè",
  "nyekonakpoè": "nyekonakpoè",
  hanoukope: "hanoukopé",
  "hanoukopé": "hanoukopé",
  akodessewa: "akodesséwa",
  "akodesséwa": "akodesséwa",
  kodjoviakope: "kodjoviakopé",
  "kodjoviakopé": "kodjoviakopé",
  dekon: "dékon",
  "dékon": "dékon",
  legbassito: "agoè",
  begu: "bè",
};

function normalizeText(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDistrict(text: string): string | null {
  const t = normalizeText(text);

  for (const [alias, canonical] of Object.entries(DISTRICT_ALIASES)) {
    if (t.includes(alias)) return canonical;
  }

  return null;
}

function looksLikeAdminGuide(text: string): AdminGuideKey {
  const t = normalizeText(text);

  if (
    t.includes("passeport") ||
    t.includes("passport")
  ) {
    return "passport";
  }

  if (
    t.includes("carte identite") ||
    t.includes("cni") ||
    t.includes("piece identite") ||
    t.includes("carte nationale")
  ) {
    return "cni";
  }

  if (
    t.includes("casier") ||
    t.includes("casier judiciaire")
  ) {
    return "casier";
  }

  return null;
}

export function routeQuery(input: string): RouteQueryResult {
  const t = normalizeText(input);
  const district = extractDistrict(input);

  const adminKey = looksLikeAdminGuide(t);
  const mentionsDemarche =
    t.includes("demarche") ||
    t.includes("document") ||
    t.includes("papier") ||
    t.includes("administratif") ||
    t.includes("administrative") ||
    adminKey !== null;

  if (mentionsDemarche && adminKey) {
    return { intent: "ADMIN_GUIDE", district, adminKey };
  }

  const mentionsOnCall =
    t.includes("garde") ||
    t.includes("urgence") ||
    t.includes("ouverte nuit") ||
    t.includes("ouverte la nuit");

  const mentionsPharmacy =
    t.includes("pharmacie") ||
    t.includes("pharmacy") ||
    t.includes("medicament") ||
    t.includes("medicaments") ||
    t.includes("medecine");

  const mentionsClinic =
    t.includes("clinique") ||
    t.includes("hopital") ||
    t.includes("hospital") ||
    t.includes("centre de sante") ||
    t.includes("sante") ||
    t.includes("medecin");

  const mentionsRestaurant =
    t.includes("restaurant") ||
    t.includes("manger") ||
    t.includes("ou manger") ||
    t.includes("fast food") ||
    t.includes("cafe") ||
    t.includes("bar") ||
    t.includes("maquis") ||
    t.includes("grillade");

  if (mentionsOnCall && mentionsPharmacy) {
    return { intent: "PHARMACY_ON_CALL", district, adminKey: null };
  }

  if (mentionsOnCall) {
    return { intent: "PHARMACY_ON_CALL", district, adminKey: null };
  }

  if (mentionsRestaurant) {
    return { intent: "RESTAURANT", district, adminKey: null };
  }

  if (mentionsPharmacy) {
    return { intent: "PHARMACY", district, adminKey: null };
  }

  if (mentionsClinic) {
    return { intent: "CLINIC", district, adminKey: null };
  }

  return { intent: "UNKNOWN", district, adminKey: null };
}
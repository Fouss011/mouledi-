export const DISTRICTS = [
  "bè",
  "tokoin",
  "agoè",
  "adidogomé",
  "nyekonakpoè",
  "hanoukopé",
  "akodesséwa",
  "kodjoviakopé",
  "dékon",
] as const;

export type District = (typeof DISTRICTS)[number];

// alias -> district canonique
export const DISTRICT_ALIASES: Record<string, District> = {
  "be": "bè",
  "bè": "bè",
  "agoe": "agoè",
  "agoè": "agoè",
  "adidogome": "adidogomé",
  "adidogomé": "adidogomé",
  "nyekonakpoe": "nyekonakpoè",
  "nyekonakpoè": "nyekonakpoè",
  "hanoukope": "hanoukopé",
  "hanoukopé": "hanoukopé",
  "akodessewa": "akodesséwa",
  "akodesséwa": "akodesséwa",
  "kodjoviakope": "kodjoviakopé",
  "kodjoviakopé": "kodjoviakopé",
  "dekon": "dékon",
  "dékon": "dékon",
};

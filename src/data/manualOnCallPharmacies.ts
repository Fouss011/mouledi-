export type ManualOnCallPharmacy = {
  id: string;
  name: string;
  district?: string;
  city?: string;
  address?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  is_on_call_now: boolean;
};

export type ManualSearchParams = {
  district?: string | null;
  nearLat?: number;
  nearLng?: number;
  limit?: number;
};

export type ManualOnCallResult = {
  provider_id: string;
  type: "pharmacy";
  name: string;
  phone?: string;
  address?: string;
  district?: string;
  city?: string;
  is_on_call_now: boolean;
  lat?: number;
  lng?: number;
  distance_km?: number | null;
};

export const MANUAL_ON_CALL_PHARMACIES: ManualOnCallPharmacy[] = [
  {
    id: "manual-1",
    name: "Pharmacie Test Agoè",
    district: "agoè",
    city: "Lomé",
    address: "Agoè, Lomé",
    phone: "+22890000001",
    lat: 6.2201,
    lng: 1.2102,
    is_on_call_now: true,
  },
  {
    id: "manual-2",
    name: "Pharmacie Test Bè",
    district: "bè",
    city: "Lomé",
    address: "Bè, Lomé",
    phone: "+22890000002",
    lat: 6.1312,
    lng: 1.2511,
    is_on_call_now: true,
  },
  {
    id: "manual-3",
    name: "Pharmacie Test Tokoin",
    district: "tokoin",
    city: "Lomé",
    address: "Tokoin, Lomé",
    phone: "+22890000003",
    lat: 6.1534,
    lng: 1.2212,
    is_on_call_now: true,
  },
];

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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function districtMatches(pharmacyDistrict?: string, requestedDistrict?: string): boolean {
  const p = normalizeText(pharmacyDistrict || "");
  const r = normalizeText(requestedDistrict || "");

  if (!r) return true;
  if (!p) return false;

  return p === r || p.includes(r) || r.includes(p);
}

export function findNearestManualOnCallPharmacies(
  params: ManualSearchParams
): ManualOnCallResult[] {
  const requestedDistrict = params.district ?? null;
  const limit = params.limit ?? 50;
  const nearLat = params.nearLat;
  const nearLng = params.nearLng;

  let rows = MANUAL_ON_CALL_PHARMACIES.filter((p) => p.is_on_call_now === true);

  if (requestedDistrict) {
    const filtered = rows.filter((p) => districtMatches(p.district, requestedDistrict));

    // si rien ne matche sur le quartier, on garde quand même la liste globale
    // pour éviter d'afficher zéro résultat à cause d'une variation d'écriture
    if (filtered.length > 0) {
      rows = filtered;
    }
  }

  const mapped: ManualOnCallResult[] = rows.map((p) => {
    let distance_km: number | null = null;

    if (
      typeof nearLat === "number" &&
      typeof nearLng === "number" &&
      typeof p.lat === "number" &&
      typeof p.lng === "number"
    ) {
      distance_km = Number(haversineKm(nearLat, nearLng, p.lat, p.lng).toFixed(2));
    }

    return {
      provider_id: `manual:${p.id}`,
      type: "pharmacy",
      name: p.name,
      phone: p.phone,
      address: p.address,
      district: p.district,
      city: p.city,
      is_on_call_now: true,
      lat: p.lat,
      lng: p.lng,
      distance_km,
    };
  });

  mapped.sort((a, b) => {
    const da = a.distance_km == null ? Number.MAX_SAFE_INTEGER : a.distance_km;
    const db = b.distance_km == null ? Number.MAX_SAFE_INTEGER : b.distance_km;
    return da - db;
  });

  return mapped.slice(0, limit);
}
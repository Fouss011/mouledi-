import Constants from "expo-constants";
import { Platform } from "react-native";
import { API_BASE_URL, STT_BASE_URL } from "../config";
import { findNearestManualOnCallPharmacies } from "../data/manualOnCallPharmacies";

export type SearchIntent =
  | "PHARMACY"
  | "CLINIC"
  | "PHARMACY_ON_CALL"
  | "RESTAURANT"
  | "ADMIN_GUIDE"
  | "UNKNOWN"
  | string;

export type PharmacyItem = {
  provider_id?: string;
  type?: string;
  name: string;
  phone?: string;
  address?: string;
  district?: string;
  city?: string;
  is_on_call_now?: boolean;
  lat?: number;
  lng?: number;
  distance_km?: number | null;
};

export type RestaurantItem = {
  provider_id?: string;
  type?: string;
  name: string;
  phone?: string;
  address?: string;
  district?: string;
  city?: string;
  lat?: number;
  lng?: number;
  distance_km?: number | null;
};

export type ResultItem = PharmacyItem | RestaurantItem;

export type IntentMatchResp = {
  intent: SearchIntent;
  confidence: number;
  scores?: { intent: string; score: number; n?: number }[];
};

// --- BASE_URL backend (dev local vs prod) ---
function getDevHostIp(): string | null {
  const hostUri = (Constants.expoConfig as any)?.hostUri as string | undefined;
  if (hostUri) return hostUri.split(":")[0];

  const h1 = (Constants as any)?.manifest2?.extra?.expoGo?.hostUri as string | undefined;
  if (h1) return h1.split(":")[0];

  const h2 = (Constants as any)?.manifest?.debuggerHost as string | undefined;
  if (h2) return h2.split(":")[0];

  return null;
}

const DEV_HOST = getDevHostIp();

// si true -> on force les URLs déployées même en Expo Go
const USE_REMOTE_SERVICES = true;

const DEV_BASE_URL = DEV_HOST ? `http://${DEV_HOST}:8000` : "http://127.0.0.1:8000";
const DEV_STT_URL = DEV_HOST ? `http://${DEV_HOST}:8001` : "http://127.0.0.1:8001";

export const BASE_URL =
  Platform.OS === "web" ? API_BASE_URL : USE_REMOTE_SERVICES ? API_BASE_URL : DEV_BASE_URL;

export const STT_URL =
  Platform.OS === "web" ? STT_BASE_URL : USE_REMOTE_SERVICES ? STT_BASE_URL : DEV_STT_URL;

// Fallback discret quand Safari/iPhone ne renvoie pas la géoloc.
// N'agit QUE si nearLat / nearLng sont absents.
const DEFAULT_FALLBACK_COORDS = {
  lat: 6.1319,
  lng: 1.2228,
};

// ----------------------
// Helpers: timeout + retry
// ----------------------
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchWithTimeout(url: string, timeoutMs = 15000, options?: RequestInit) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...(options || {}), signal: controller.signal }).finally(() => clearTimeout(t));
}

async function retryFetch(
  url: string,
  options: RequestInit = {},
  cfg: { retries?: number; timeoutMs?: number; backoffMs?: number } = {}
) {
  const retries = cfg.retries ?? 3;
  const timeoutMs = cfg.timeoutMs ?? 25000;
  const backoffMs = cfg.backoffMs ?? 900;

  let lastErr: any = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs, options);
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(backoffMs * attempt);
    }
  }

  throw lastErr;
}

// ----------------------
// Health checks
// ----------------------
export async function pingBackend(): Promise<boolean> {
  try {
    console.log("BASE_URL =", BASE_URL);
    const r = await retryFetch(`${BASE_URL}/health`, { method: "GET" }, { retries: 3, timeoutMs: 25000 });
    console.log("pingBackend status =", r.status);
    return r.ok;
  } catch (e: any) {
    console.log("pingBackend error =", e?.name, e?.message || e);
    return false;
  }
}

export async function pingStt(): Promise<boolean> {
  try {
    console.log("STT_URL =", STT_URL);
    const r = await retryFetch(`${STT_URL}/health`, { method: "GET" }, { retries: 3, timeoutMs: 25000 });
    console.log("pingStt status =", r.status);
    return r.ok;
  } catch (e: any) {
    console.log("pingStt error =", e?.name, e?.message || e);
    return false;
  }
}

// ----------------------
// Providers / Places API
// ----------------------
function buildProvidersUrl(opts: {
  type: "pharmacy" | "clinic" | "restaurant";
  district?: string | null;
  onCallNow?: boolean;
  limit?: number;
  nearLat?: number;
  nearLng?: number;
  maxKm?: number;
}) {
  const params = new URLSearchParams();

  params.set("type", opts.type);
  params.set("limit", String(opts.limit ?? 50));

  if (opts.onCallNow) params.set("on_call_now", "true");
  if (opts.district) params.set("district", opts.district);

  const hasUserCoords = opts.nearLat != null && opts.nearLng != null;

  if (hasUserCoords) {
    // Comportement actuel conservé
    params.set("near_lat", String(opts.nearLat));
    params.set("near_lng", String(opts.nearLng));
    params.set("source", "auto");
    params.set("max_km", String(opts.maxKm ?? 5));
  } else {
    // Fallback doux: on garde le moteur vivant même si Safari ne donne pas la position
    params.set("near_lat", String(DEFAULT_FALLBACK_COORDS.lat));
    params.set("near_lng", String(DEFAULT_FALLBACK_COORDS.lng));
    params.set("source", "osm");
    params.set("max_km", String(opts.maxKm ?? 10));
  }

  return `${BASE_URL}/health/providers?${params.toString()}`;
}

async function fetchProviders(url: string): Promise<ResultItem[]> {
  const r = await retryFetch(url, { method: "GET" }, { retries: 3, timeoutMs: 25000 });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`API error ${r.status}: ${txt}`);
  }
  const data = await r.json();
  return Array.isArray(data?.items) ? data.items : [];
}

// ----------------------
// Manual on-call pharmacies (local fallback first)
// ----------------------
export async function searchPharmaciesOnCall(
  district: string | null,
  nearLat?: number,
  nearLng?: number
): Promise<PharmacyItem[]> {
  const localManual = findNearestManualOnCallPharmacies({
    district,
    nearLat,
    nearLng,
    limit: 50,
  });

  if (localManual.length > 0) {
    return localManual;
  }

  const url = buildProvidersUrl({
    type: "pharmacy",
    district,
    onCallNow: true,
    limit: 50,
    nearLat,
    nearLng,
    maxKm: 7,
  });

  const remote = (await fetchProviders(url)) as PharmacyItem[];
  if (remote.length > 0) return remote;

  const fallbackUrl = buildProvidersUrl({
    type: "pharmacy",
    district,
    onCallNow: false,
    limit: 50,
    nearLat,
    nearLng,
    maxKm: 7,
  });

  return (await fetchProviders(fallbackUrl)) as PharmacyItem[];
}

export async function searchPharmacies(
  district: string | null,
  nearLat?: number,
  nearLng?: number
): Promise<PharmacyItem[]> {
  const url = buildProvidersUrl({
    type: "pharmacy",
    district,
    onCallNow: false,
    limit: 50,
    nearLat,
    nearLng,
    maxKm: 8,
  });
  return (await fetchProviders(url)) as PharmacyItem[];
}

export async function searchClinics(
  district: string | null,
  nearLat?: number,
  nearLng?: number
): Promise<PharmacyItem[]> {
  const url = buildProvidersUrl({
    type: "clinic",
    district,
    onCallNow: false,
    limit: 50,
    nearLat,
    nearLng,
    maxKm: 8,
  });
  return (await fetchProviders(url)) as PharmacyItem[];
}

export async function searchRestaurants(
  district: string | null,
  nearLat?: number,
  nearLng?: number
): Promise<RestaurantItem[]> {
  const url = buildProvidersUrl({
    type: "restaurant",
    district,
    onCallNow: false,
    limit: 50,
    nearLat,
    nearLng,
    maxKm: 10,
  });
  return (await fetchProviders(url)) as RestaurantItem[];
}

// -----------------
// Intent audio matching
// -----------------
export async function matchIntentFromAudio(audioUri: string, minConf = 0.0): Promise<IntentMatchResp> {
  const form = new FormData();
  form.append("file", {
    uri: audioUri,
    name: "intent.m4a",
    type: "audio/m4a",
  } as any);

  const r = await retryFetch(
    `${BASE_URL}/intent/match?min_conf=${encodeURIComponent(String(minConf))}`,
    { method: "POST", body: form },
    { retries: 2, timeoutMs: 60000, backoffMs: 1200 }
  );

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Intent match error ${r.status}: ${txt}`);
  }

  return await r.json();
}

export async function matchIntentFromBlob(blob: Blob, minConf = 0.0): Promise<IntentMatchResp> {
  const form = new FormData();
  form.append("file", blob, "intent.webm");

  const r = await retryFetch(
    `${BASE_URL}/intent/match?min_conf=${encodeURIComponent(String(minConf))}`,
    { method: "POST", body: form },
    { retries: 2, timeoutMs: 60000, backoffMs: 1200 }
  );

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Intent match error ${r.status}: ${txt}`);
  }

  return await r.json();
}

// -----------------
// STT (mobile)
// -----------------
export async function sttFromAudio(audioUri: string): Promise<{ text: string; elapsed_s?: number }> {
  const form = new FormData();
  form.append("audio", {
    uri: audioUri,
    name: "speech.m4a",
    type: "audio/m4a",
  } as any);

  console.log("STT_URL =", STT_URL);

  const r = await retryFetch(
    `${STT_URL}/stt`,
    { method: "POST", body: form },
    { retries: 2, timeoutMs: 60000, backoffMs: 1200 }
  );

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`STT error ${r.status}: ${txt}`);
  }

  return await r.json();
}

// -----------------
// STT (web)
// -----------------
export async function sttFromBlob(blob: Blob): Promise<{ text: string; elapsed_s?: number }> {
  const form = new FormData();
  form.append("audio", blob, "speech.webm");

  const r = await retryFetch(
    `${STT_URL}/stt`,
    { method: "POST", body: form },
    { retries: 2, timeoutMs: 60000, backoffMs: 1200 }
  );

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`STT error ${r.status}: ${txt}`);
  }

  return await r.json();
}
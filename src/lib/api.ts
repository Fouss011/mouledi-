import Constants from "expo-constants";
import { Platform } from "react-native";
import { API_BASE_URL, STT_BASE_URL } from "../config";

export type PharmacyItem = {
  provider_id?: string;
  type?: string;
  name: string;
  phone?: string;
  address?: string;
  district?: string;
  city?: string;
  is_on_call_now?: boolean;
};

// --- BASE_URL backend (mobile dev vs web prod) ---
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

// ✅ Toggle : si true -> on force les URLs déployées même en Expo Go
// ✅ Web => URLs prod
// ✅ Mobile => par défaut prod (Fly). Local seulement si EXPO_PUBLIC_USE_REMOTE=0

const USE_REMOTE_SERVICES =
  (process.env.EXPO_PUBLIC_USE_REMOTE ?? "1") === "1"; // "1" = prod, "0" = local

const DEV_BASE_URL = DEV_HOST ? `http://${DEV_HOST}:8000` : "http://127.0.0.1:8000";
const DEV_STT_URL  = DEV_HOST ? `http://${DEV_HOST}:8001` : "http://127.0.0.1:8001";

export const BASE_URL =
  Platform.OS === "web" ? API_BASE_URL : USE_REMOTE_SERVICES ? API_BASE_URL : DEV_BASE_URL;

export const STT_URL =
  Platform.OS === "web" ? STT_BASE_URL : USE_REMOTE_SERVICES ? STT_BASE_URL : DEV_STT_URL;

// --- utils ---
function fetchWithTimeout(url: string, timeoutMs = 9000, options?: RequestInit) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...(options || {}), signal: controller.signal }).finally(() => clearTimeout(t));
}

export async function pingBackend(): Promise<boolean> {
  try {
    console.log("BASE_URL =", BASE_URL);
    const r = await fetchWithTimeout(`${BASE_URL}/health`, 8000);
    console.log("pingBackend status =", r.status);
    return r.ok;
  } catch (e: any) {
    console.log("pingBackend error =", e?.name, e?.message || e);
    return false;
  }
}

function buildProvidersUrl(opts: {
  type: "pharmacy" | "clinic";
  district?: string | null;
  onCallNow?: boolean;
  limit?: number;
  nearLat?: number;
  nearLng?: number;
}) {
  const params = new URLSearchParams();
  params.set("type", opts.type);
  params.set("limit", String(opts.limit ?? 50));

  if (opts.onCallNow) params.set("on_call_now", "true");

  if (opts.nearLat != null && opts.nearLng != null) {
    params.set("near_lat", String(opts.nearLat));
    params.set("near_lng", String(opts.nearLng));
  }

  if (opts.district) params.set("district", opts.district);

  return `${BASE_URL}/health/providers?${params.toString()}`;
}

async function fetchProviders(url: string): Promise<PharmacyItem[]> {
  const r = await fetchWithTimeout(url, 9000);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`API error ${r.status}: ${txt}`);
  }
  const data = await r.json();
  return Array.isArray(data?.items) ? data.items : [];
}

export async function searchPharmaciesOnCall(
  district: string | null,
  nearLat?: number,
  nearLng?: number
): Promise<PharmacyItem[]> {
  const url = buildProvidersUrl({
    type: "pharmacy",
    district,
    onCallNow: true,
    limit: 50,
    nearLat,
    nearLng,
  });
  return fetchProviders(url);
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
  });
  return fetchProviders(url);
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
  });
  return fetchProviders(url);
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

  const r = await fetchWithTimeout(`${STT_URL}/stt`, 15000, { method: "POST", body: form });

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
  // ✅ web enregistre souvent en webm
  form.append("audio", blob, "speech.webm");

  const r = await fetchWithTimeout(`${STT_URL}/stt`, 15000, { method: "POST", body: form });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`STT error ${r.status}: ${txt}`);
  }
  return await r.json();
}
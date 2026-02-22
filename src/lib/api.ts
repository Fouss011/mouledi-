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

// ✅ Pour WEB : on force Fly
// ✅ Pour MOBILE : si Expo Go trouve l'IP, on garde (dev), sinon on force Fly aussi
export const BASE_URL =
  Platform.OS === "web"
    ? API_BASE_URL
    : DEV_HOST
    ? `http://${DEV_HOST}:8000`
    : API_BASE_URL;

// ✅ STT : web -> Fly direct ; mobile -> Fly direct aussi (car STT est séparé)
export const STT_URL = STT_BASE_URL;

// --- utils ---
function fetchWithTimeout(url: string, timeoutMs = 9000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(t));
}

export async function pingBackend(): Promise<boolean> {
  try {
    const r = await fetchWithTimeout(`${BASE_URL}/health`, 5000);
    return r.ok;
  } catch {
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

  const r = await fetch(`${STT_URL}/stt`, { method: "POST", body: form });

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

  const r = await fetch(`${STT_URL}/stt`, { method: "POST", body: form });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`STT error ${r.status}: ${txt}`);
  }
  return await r.json();
}
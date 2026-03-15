import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, Linking, Platform } from "react-native";
import * as Speech from "expo-speech";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Location from "expo-location";

import { RootStackParamList } from "../../App";
import {
  searchPharmaciesOnCall,
  searchPharmacies,
  searchClinics,
  searchRestaurants,
  ResultItem,
  pingBackend,
  pingStt,
  sttFromAudio,
  sttFromBlob,
  BASE_URL,
  matchIntentFromAudio,
  matchIntentFromBlob,
} from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Results">;

type AudioIntent =
  | "PHARMACY"
  | "CLINIC"
  | "PHARMACY_ON_CALL"
  | "RESTAURANT"
  | "PASSPORT"
  | "CNI"
  | "UNKNOWN";

let currentSound: Audio.Sound | null = null;
let playSeq = 0;

async function stopCurrentSound() {
  try {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      currentSound = null;
    }
  } catch {}
}

async function stopAllAudio() {
  try {
    Speech.stop();
  } catch {}
  await stopCurrentSound();
}

async function playUi(key: string, lang: "mina" | "fr" | "kabyè" = "mina") {
  const seq = ++playSeq;

  try {
    await stopAllAudio();

    const r = await fetch(
      `${BASE_URL}/health/ui-audio?key=${encodeURIComponent(key)}&lang=${encodeURIComponent(lang)}`
    );
    if (!r.ok) return;

    const data = await r.json();
    const url = data.url as string;
    if (!url) return;

    if (seq !== playSeq) return;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });

    const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });

    if (seq !== playSeq) {
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch {}
      return;
    }

    currentSound = sound;

    sound.setOnPlaybackStatusUpdate((st: any) => {
      if (st?.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        if (currentSound === sound) currentSound = null;
      }
    });
  } catch {}
}

async function getNearCoordsSafe(timeoutMs = 8000): Promise<{ nearLat: number | null; nearLng: number | null }> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && (navigator as any).geolocation) {
    return await new Promise((resolve) => {
      let done = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ nearLat: null, nearLng: null });
      }, timeoutMs);

      (navigator as any).geolocation.getCurrentPosition(
        (pos: any) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ nearLat: pos.coords.latitude, nearLng: pos.coords.longitude });
        },
        () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ nearLat: null, nearLng: null });
        },
        { enableHighAccuracy: true, timeout: timeoutMs }
      );
    });
  }

  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { nearLat: null, nearLng: null };

    const locPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));

    const loc = (await Promise.race([locPromise, timeoutPromise])) as any;
    if (!loc?.coords) return { nearLat: null, nearLng: null };

    return { nearLat: loc.coords.latitude, nearLng: loc.coords.longitude };
  } catch {
    return { nearLat: null, nearLng: null };
  }
}

type AudioIntentResp = {
  intent: string;
  confidence: number;
  scores?: Array<{ intent: string; score: number; n?: number }>;
};

function normalizeIntent(i: string): AudioIntent {
  const x = (i || "").toUpperCase().trim();
  if (x === "PHARMACY") return "PHARMACY";
  if (x === "CLINIC") return "CLINIC";
  if (x === "PHARMACY_ON_CALL") return "PHARMACY_ON_CALL";
  if (x === "RESTAURANT") return "RESTAURANT";
  if (x === "PASSPORT") return "PASSPORT";
  if (x === "CNI") return "CNI";
  return "UNKNOWN";
}

function pickClearAudioIntent(
  resp: AudioIntentResp | null,
  opts?: { minConf?: number; minDelta?: number }
): { intent: AudioIntent; conf: number } {
  const minConf = opts?.minConf ?? 0.62;
  const minDelta = opts?.minDelta ?? 0.08;

  if (!resp) return { intent: "UNKNOWN", conf: 0 };

  const scores = Array.isArray(resp.scores) ? resp.scores : [];
  const top1 = scores[0];
  const top2 = scores[1];

  const bestIntent = (top1?.intent || resp.intent || "UNKNOWN").toUpperCase();
  const conf = typeof resp.confidence === "number" ? resp.confidence : 0;

  const s1 = typeof top1?.score === "number" ? top1.score : -1;
  const s2 = typeof top2?.score === "number" ? top2.score : -1;
  const delta = s1 - s2;

  const isClear = conf >= minConf && delta >= minDelta && bestIntent !== "UNKNOWN";
  return { intent: isClear ? normalizeIntent(bestIntent) : "UNKNOWN", conf };
}

function guessIntentFromText(text: string): AudioIntent {
  const t = (text || "").toLowerCase();

  const looksPassport =
    t.includes("passeport") ||
    t.includes("passport");

  const looksCni =
    t.includes("carte d'identité") ||
    t.includes("carte identité") ||
    t.includes("carte d identite") ||
    t.includes("cni") ||
    t.includes("identité") ||
    t.includes("identite");

  const looksOnCall = t.includes("garde") || t.includes("urgence");

  const looksClinic =
    t.includes("clini") ||
    t.includes("hop") ||
    t.includes("hôp") ||
    t.includes("centre de santé") ||
    t.includes("santé");

  const looksRestaurant =
    t.includes("restaurant") ||
    t.includes("manger") ||
    t.includes("maquis") ||
    t.includes("grillade") ||
    t.includes("fast food") ||
    t.includes("cafe");

  const looksPharmacy =
    t.includes("pharm") ||
    t.includes("médic") ||
    t.includes("medic");

  if (looksPassport) return "PASSPORT";
  if (looksCni) return "CNI";
  if (looksOnCall) return "PHARMACY_ON_CALL";
  if (looksClinic) return "CLINIC";
  if (looksRestaurant) return "RESTAURANT";
  if (looksPharmacy) return "PHARMACY";
  return "UNKNOWN";
}

export default function ResultsScreen({ navigation, route }: Props) {
  const { district, queryText, nearLat, nearLng, intent } = route.params;

  const [nearLatState, setNearLatState] = useState<number | null>(nearLat ?? null);
  const [nearLngState, setNearLngState] = useState<number | null>(nearLng ?? null);
  const hasCoords = nearLatState != null && nearLngState != null;

  const [items, setItems] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [statusText, setStatusText] = useState<string>("");

  const [webRec, setWebRec] = useState<MediaRecorder | null>(null);

  const mode = useMemo(() => {
    if (intent === "PHARMACY_ON_CALL") return "oncall";
    if (intent === "CLINIC") return "clinic";
    if (intent === "RESTAURANT") return "restaurant";
    return "all";
  }, [intent]);

  const failCountRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        });
      } catch {}
    })();
  }, []);

  const loadData = async (
    d: string | null,
    lat?: number | null,
    lng?: number | null,
    m?: "oncall" | "clinic" | "all" | "restaurant"
  ) => {
    setError(null);
    setLoading(true);

    const modeFinal = m ?? "all";
    let res: ResultItem[] = [];

    try {
      if (modeFinal === "oncall") {
        res = await searchPharmaciesOnCall(d, lat ?? undefined, lng ?? undefined);
        if (res.length === 0) res = await searchPharmacies(d, lat ?? undefined, lng ?? undefined);
      } else if (modeFinal === "clinic") {
        res = await searchClinics(d, lat ?? undefined, lng ?? undefined);
      } else if (modeFinal === "restaurant") {
        res = await searchRestaurants(d, lat ?? undefined, lng ?? undefined);
      } else {
        res = await searchPharmacies(d, lat ?? undefined, lng ?? undefined);
      }

      setItems(res);
      setLoading(false);

      failCountRef.current = 0;

      if (res.length > 0) {
        await playUi("tap_item_to_listen");
      } else {
        await playUi("fallback_pharmacies_or_retry");
      }
    } catch (e: any) {
      setError(e?.message ?? "Erreur inconnue.");
      setLoading(false);
    }
  };

  const handleUnknownQuery = async () => {
    failCountRef.current += 1;
    setStatusText("Je n’ai pas compris. Dis : pharmacie, clinique, restaurant.");
    await playUi("fallback_pharmacies_or_retry");
    navigation.goBack();
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        await loadData(district, nearLatState, nearLngState, mode);

        if (mounted && (nearLatState == null || nearLngState == null)) {
          const coords = await getNearCoordsSafe(8000);
          if (!mounted) return;

          if (coords.nearLat != null && coords.nearLng != null) {
            setNearLatState(coords.nearLat);
            setNearLngState(coords.nearLng);
            setStatusText("");
            await loadData(district, coords.nearLat, coords.nearLng, mode);
          } else {
            setStatusText("Localisation inactive (distance indisponible)");
          }
        }
      } catch {}
    })();

    return () => {
      mounted = false;
      Speech.stop();
      stopAllAudio().catch(() => {});
    };
  }, [district, intent]);

  const callPhone = async (phone?: string) => {
    if (!phone) return;
    const url = `tel:${phone.replace(/\s+/g, "")}`;
    const can = await Linking.canOpenURL(url);
    if (can) Linking.openURL(url);
  };

  const openMaps = async (item: ResultItem) => {
    try {
      const labelParts = [item.name, item.address, item.district, item.city].filter(Boolean);
      const label = labelParts.join(", ");

      let url = "";

      if (Platform.OS === "ios") {
        if (label && item.lat != null && item.lng != null) {
          url = `http://maps.apple.com/?q=${encodeURIComponent(item.name)}&ll=${item.lat},${item.lng}`;
        } else if (label) {
          url = `http://maps.apple.com/?q=${encodeURIComponent(label)}`;
        } else if (item.lat != null && item.lng != null) {
          url = `http://maps.apple.com/?ll=${item.lat},${item.lng}`;
        } else {
          return;
        }
      } else {
        if (label) {
          url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`;
        } else if (item.lat != null && item.lng != null) {
          url = `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`;
        } else {
          return;
        }
      }

      await Linking.openURL(url);
    } catch (e) {
      console.log("openMaps error:", e);
    }
  };

  const speakNameOnly = async (name: string) => {
    await stopAllAudio();
    Speech.speak(name, { language: "fr-FR", rate: 0.95 });
  };

  const startRecording = async () => {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      setStatusText("Permission micro refusée.");
      await playUi("repeat_please");
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });

    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync({
      android: {
        extension: ".m4a",
        outputFormat: Audio.AndroidOutputFormat.MPEG_4,
        audioEncoder: Audio.AndroidAudioEncoder.AAC,
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 24000,
      },
      ios: {
        extension: ".m4a",
        audioQuality: Audio.IOSAudioQuality.LOW,
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 24000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
    } as any);

    await rec.startAsync();
    setRecording(rec);
    setStatusText("J'écoute...");
  };

  const tryHandleVoiceCommand = async (text: string) => {
    const t = (text || "").toLowerCase();

    if (t.includes("retour") || t.includes("accueil") || t.includes("home")) {
      navigation.goBack();
      return true;
    }

    const m = t.match(/\b(appelle|appeler|call)\s+(\d+)\b/);
    if (m?.[2]) {
      const idx = parseInt(m[2], 10) - 1;
      if (!Number.isNaN(idx) && idx >= 0 && idx < items.length) {
        const target = items[idx];
        if (target?.phone) callPhone(target.phone);
      }
      return true;
    }

    return false;
  };

  const handleResolvedIntent = async (
    resolvedIntent: AudioIntent,
    lat: number | null,
    lng: number | null,
    textForQuery = ""
  ) => {
    if (resolvedIntent === "PHARMACY_ON_CALL") {
      setStatusText("✅ Pharmacie de garde");
      await loadData(district, lat, lng, "oncall");
      return true;
    }
    if (resolvedIntent === "CLINIC") {
      setStatusText("✅ Clinique");
      await loadData(district, lat, lng, "clinic");
      return true;
    }
    if (resolvedIntent === "RESTAURANT") {
      setStatusText("✅ Restaurant");
      await loadData(district, lat, lng, "restaurant");
      return true;
    }
    if (resolvedIntent === "PASSPORT") {
      setStatusText("✅ Passeport");
      navigation.navigate("Guide", { guideKey: "passport", lang: "fr" });
      return true;
    }
    if (resolvedIntent === "CNI") {
      setStatusText("✅ Carte d’identité");
      navigation.navigate("Guide", { guideKey: "cni", lang: "fr" });
      return true;
    }
    if (resolvedIntent === "PHARMACY") {
      setStatusText("✅ Pharmacie");
      await loadData(district, lat, lng, "all");
      return true;
    }

    return false;
  };

  const stopRecordingAndSearch = async (rec: Audio.Recording) => {
    setStatusText("Traitement...");
    await rec.stopAndUnloadAsync();

    const st = await rec.getStatusAsync();
    const ms = (st as any)?.durationMillis ?? 0;
    if (ms < 900) {
      setRecording(null);
      setStatusText("Répétez");
      await playUi("repeat_please");
      return;
    }

    const uri = rec.getURI();
    setRecording(null);

    if (!uri) {
      setStatusText("Erreur audio");
      await playUi("repeat_please");
      return;
    }

    setStatusText("Réveil serveur…");
    const okApi = await pingBackend();
    const okStt = await pingStt();

    if (!okApi) {
      setStatusText("Backend indisponible");
      await playUi("repeat_please");
      return;
    }
    if (!okStt) {
      setStatusText("Assistance vocale indisponible");
      await playUi("repeat_please");
      return;
    }

    let lat = nearLatState;
    let lng = nearLngState;

    if (lat == null || lng == null) {
      const coords = await getNearCoordsSafe(8000);
      lat = coords.nearLat;
      lng = coords.nearLng;
      setNearLatState(lat);
      setNearLngState(lng);
    }

    setStatusText("Compréhension audio…");
    let audioIntent: AudioIntent = "UNKNOWN";
    try {
      const resp = (await matchIntentFromAudio(uri)) as AudioIntentResp;
      audioIntent = pickClearAudioIntent(resp, { minConf: 0.62, minDelta: 0.08 }).intent;
    } catch {}

    if (audioIntent !== "UNKNOWN") {
      const handled = await handleResolvedIntent(audioIntent, lat, lng);
      if (handled) return;
    }

    setStatusText("Reconnaissance STT…");
    const { text } = await sttFromAudio(uri);

    if (await tryHandleVoiceCommand(text)) {
      setStatusText(`Commande: ${text}`);
      return;
    }

    if (!text || text.trim().length < 2) {
      await handleUnknownQuery();
      return;
    }

    setStatusText(`Reconnu: ${text}`);

    const guessed = guessIntentFromText(text);
    const handled = await handleResolvedIntent(guessed, lat, lng, text);
    if (handled) return;

    await handleUnknownQuery();
  };

  const onPressMic = async () => {
    try {
      await stopAllAudio();

      if (Platform.OS === "web") {
        if (!webRec) {
          setStatusText("J'écoute...");

          const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true });
          const rec = new MediaRecorder(stream);
          const chunks: BlobPart[] = [];

          rec.ondataavailable = (e: any) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };

          rec.onstop = async () => {
            try {
              setStatusText("Traitement...");
              const blob = new Blob(chunks, { type: "audio/webm" });

              setStatusText("Réveil serveur…");
              const okApi = await pingBackend();
              const okStt = await pingStt();

              if (!okApi) {
                setStatusText("Backend indisponible");
                await playUi("repeat_please");
                return;
              }
              if (!okStt) {
                setStatusText("Assistance vocale indisponible");
                await playUi("repeat_please");
                return;
              }

              let lat = nearLatState;
              let lng = nearLngState;
              if (lat == null || lng == null) {
                const coords = await getNearCoordsSafe(8000);
                lat = coords.nearLat;
                lng = coords.nearLng;
                setNearLatState(lat);
                setNearLngState(lng);
              }

              setStatusText("Compréhension audio…");
              let audioIntent: AudioIntent = "UNKNOWN";
              try {
                const resp = (await matchIntentFromBlob(blob)) as AudioIntentResp;
                audioIntent = pickClearAudioIntent(resp, { minConf: 0.62, minDelta: 0.08 }).intent;
              } catch {}

              if (audioIntent !== "UNKNOWN") {
                const handled = await handleResolvedIntent(audioIntent, lat, lng);
                if (handled) return;
              }

              setStatusText("Reconnaissance STT…");
              const { text } = await sttFromBlob(blob);

              if (await tryHandleVoiceCommand(text)) {
                setStatusText(`Commande: ${text}`);
                return;
              }

              if (!text || text.trim().length < 2) {
                await handleUnknownQuery();
                return;
              }

              setStatusText(`Reconnu: ${text}`);

              const guessed = guessIntentFromText(text);
              const handled = await handleResolvedIntent(guessed, lat, lng, text);
              if (handled) return;

              await handleUnknownQuery();
            } catch (e: any) {
              console.error("MIC/WEB error:", e?.message || e);
              setStatusText("Erreur pendant l’enregistrement");
              await playUi("repeat_please");
            } finally {
              setWebRec(null);
            }
          };

          rec.start();
          setWebRec(rec);
          return;
        } else {
          setStatusText("Traitement...");
          webRec.stop();
          setWebRec(null);
          return;
        }
      }

      if (recording) {
        await stopRecordingAndSearch(recording);
      } else {
        await startRecording();
      }
    } catch (e: any) {
      console.error("MIC flow error:", e?.message || e);
      setRecording(null);
      setStatusText("Erreur pendant l’enregistrement");
      await playUi("repeat_please");
    }
  };

  const requestGeoAndReload = async () => {
    setStatusText("Localisation...");
    const coords = await getNearCoordsSafe(8000);

    if (coords.nearLat != null && coords.nearLng != null) {
      setNearLatState(coords.nearLat);
      setNearLngState(coords.nearLng);
      setStatusText("");
      await loadData(district, coords.nearLat, coords.nearLng, mode);
    } else {
      setStatusText("Localisation refusée (distance indisponible)");
      await playUi("fallback_pharmacies_or_retry");
    }
  };

  const pageTitle =
    intent === "CLINIC"
      ? "Cliniques"
      : intent === "PHARMACY_ON_CALL"
      ? "Pharmacies de garde"
      : intent === "RESTAURANT"
      ? "Restaurants"
      : "Pharmacies";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={async () => {
            await stopAllAudio();
            navigation.goBack();
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>←</Text>
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{pageTitle}</Text>

          <Text style={styles.subtitle}>
            {hasCoords ? "Triés par distance (près de vous)" : district ? `Quartier: ${district}` : "Sans localisation"}
          </Text>

          <Text style={styles.query}>Requête: {queryText}</Text>
        </View>

        <Pressable
          onPress={async () => {
            await stopAllAudio();
            navigation.reset({
              index: 0,
              routes: [
                {
                  name: "Home",
                  params: {
                    autoStartMic: true,
                    skipLanguagePicker: true,
                  } as any,
                },
              ],
            });
          }}
          style={styles.micMini}
        >
          <Text style={styles.micMiniText}>🎙️</Text>
        </Pressable>
      </View>

      {statusText ? <Text style={styles.status}>{statusText}</Text> : null}

      {!hasCoords ? (
        <View style={styles.geoBox}>
          <Text style={styles.geoText}>Active la localisation pour voir la distance et le tri près de toi.</Text>
          <Pressable onPress={requestGeoAndReload} style={styles.geoBtn}>
            <Text style={styles.geoBtnText}>Activer</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? <Text style={styles.loading}>Chargement...</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !error ? (
        <FlatList
          data={items}
          keyExtractor={(it, idx) => `${it.provider_id ?? it.name}-${idx}`}
          contentContainerStyle={{ paddingBottom: 30, paddingTop: 4 }}
          renderItem={({ item, index }) => {
            const distanceLine =
              item.distance_km != null
                ? ` • ${item.distance_km} km`
                : hasCoords
                ? " • …"
                : "";

            return (
              <Pressable onPress={() => speakNameOnly(item.name)} style={styles.card}>
                <View style={styles.cardTopRow}>
                  <View style={styles.titleWrap}>
                    <View style={styles.indexBadge}>
                      <Text style={styles.indexBadgeText}>{index + 1}</Text>
                    </View>

                    <Text style={styles.cardTitle}>{item.name}</Text>
                  </View>

                  <Pressable
                    onPress={async () => {
                      await stopAllAudio();
                      await openMaps(item);
                    }}
                    style={styles.mapBtn}
                  >
                    <Text style={styles.mapBtnText}>🗺️</Text>
                  </Pressable>
                </View>

                <Text style={styles.cardText}>
                  {item.district ? item.district : "—"}
                  {item.city ? `, ${item.city}` : ""}
                  {distanceLine}
                </Text>

                {item.phone ? <Text style={styles.cardSub}>📞 {item.phone}</Text> : null}

                {item.phone ? (
                  <Pressable
                    onPress={async () => {
                      await stopAllAudio();
                      callPhone(item.phone);
                    }}
                    style={styles.callBtn}
                  >
                    <Text style={styles.callText}>Appeler</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.cardMuted}>Téléphone indisponible</Text>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.loading}>Aucun résultat.</Text>}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", paddingTop: 54, paddingHorizontal: 16 },

  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },

  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#222",
  },
  backText: { color: "#fff", fontSize: 20 },

  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "#aaa", marginTop: 2 },
  query: { color: "#666", marginTop: 6, fontSize: 12 },

  micMini: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#222",
  },
  micMiniText: { color: "#fff", fontSize: 18 },

  status: { color: "#bbb", textAlign: "center", marginTop: 6 },

  geoBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#0b0b0b",
  },
  geoText: { color: "#bbb", fontSize: 13, marginBottom: 10 },
  geoBtn: {
    backgroundColor: "#111",
    borderColor: "#333",
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  geoBtnText: { color: "#fff", fontWeight: "700" },

  loading: { color: "#bbb", marginTop: 18, textAlign: "center" },
  error: { color: "#ff8a8a", marginTop: 12, textAlign: "center" },

  card: {
    backgroundColor: "#0b0b0b",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingRight: 8,
  },
  indexBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#333",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  indexBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },
  cardTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
    lineHeight: 22,
  },
  mapBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  mapBtnText: {
    fontSize: 18,
    color: "#fff",
  },

  cardText: { color: "#bbb", marginTop: 10, lineHeight: 20 },
  cardSub: { color: "#888", marginTop: 8, fontSize: 13 },
  cardMuted: { color: "#666", marginTop: 12 },

  callBtn: {
    marginTop: 12,
    backgroundColor: "#111",
    borderColor: "#333",
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  callText: { color: "#fff", fontWeight: "700" },
});
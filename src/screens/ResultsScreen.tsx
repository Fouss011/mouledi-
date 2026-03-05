// src/screens/ResultsScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
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
  PharmacyItem,
  sttFromAudio,
  sttFromBlob,
  pingBackend,
  pingStt,
  BASE_URL,
  matchIntentFromAudio,
  matchIntentFromBlob,
} from "../lib/api";
import { routeQuery } from "../lib/nlu";

type Props = NativeStackScreenProps<RootStackParamList, "Results">;

/** --- UI AUDIO (mina) helper local --- */
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

async function playUi(key: string, lang: string = "mina") {
  const seq = ++playSeq;

  try {
    await stopAllAudio();

    const r = await fetch(`${BASE_URL}/health/ui-audio?key=${encodeURIComponent(key)}&lang=${encodeURIComponent(lang)}`);
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

/** ✅ Localisation robuste (web + mobile) */
async function getNearCoordsSafe(timeoutMs = 8000): Promise<{ nearLat: number | null; nearLng: number | null }> {
  // WEB
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

  // MOBILE
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

/** ✅ INTENT AUDIO helpers */
type AudioIntentResp = {
  intent: string;
  confidence: number;
  scores?: Array<{ intent: string; score: number; n?: number }>;
};

function normalizeIntent(i: string): "PHARMACY" | "CLINIC" | "PHARMACY_ON_CALL" | "UNKNOWN" {
  const x = (i || "").toUpperCase().trim();
  if (x === "PHARMACY") return "PHARMACY";
  if (x === "CLINIC") return "CLINIC";
  if (x === "PHARMACY_ON_CALL") return "PHARMACY_ON_CALL";
  return "UNKNOWN";
}

function pickClearAudioIntent(
  resp: AudioIntentResp | null,
  opts?: { minConf?: number; minDelta?: number }
): { intent: "PHARMACY" | "CLINIC" | "PHARMACY_ON_CALL" | "UNKNOWN"; conf: number } {
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

export default function ResultsScreen({ navigation, route }: Props) {
  const { district, queryText, nearLat, nearLng, intent } = route.params as any;

  const [nearLatState, setNearLatState] = useState<number | null>(nearLat ?? null);
  const [nearLngState, setNearLngState] = useState<number | null>(nearLng ?? null);
  const hasCoords = nearLatState != null && nearLngState != null;

  const [items, setItems] = useState<PharmacyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [statusText, setStatusText] = useState<string>("");

  const [webRec, setWebRec] = useState<MediaRecorder | null>(null);
  const [webStream, setWebStream] = useState<any>(null);

  // ✅ UI listening state (WEB uses webRec, MOBILE uses recording)
  const isListening = Platform.OS === "web" ? !!webRec : !!recording;

  const mode = useMemo(() => {
    return intent === "PHARMACY_ON_CALL" ? "oncall" : intent === "CLINIC" ? "clinic" : "all";
  }, [intent]);

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

  const loadData = async (d: string | null, lat?: number | null, lng?: number | null, m?: "oncall" | "clinic" | "all") => {
    setError(null);
    setLoading(true);

    const modeFinal = m ?? "all";
    let res: PharmacyItem[] = [];

    try {
      if (modeFinal === "oncall") {
        res = await searchPharmaciesOnCall(d, lat ?? undefined, lng ?? undefined);
        if (res.length === 0) res = await searchPharmacies(d, lat ?? undefined, lng ?? undefined);
      } else if (modeFinal === "clinic") {
        res = await searchClinics(d, lat ?? undefined, lng ?? undefined);
        if (res.length === 0) {
          setItems([]);
          setLoading(false);
          await playUi("fallback_pharmacies_or_retry");
          return;
        }
      } else {
        res = await searchPharmacies(d, lat ?? undefined, lng ?? undefined);
      }

      setItems(res);
      setLoading(false);

      if (res.length > 0) {
        await playUi("tap_item_to_listen");
      }
    } catch (e: any) {
      setError(e?.message ?? "Erreur inconnue.");
      setLoading(false);
    }
  };

  // ✅ UNKNOWN sur Results => audio + petit délai + retour accueil (anti-confusion)
  const handleUnknownQuery = async () => {
    await playUi("fallback_pharmacies_or_retry");
    setStatusText("Je n’ai pas compris. Réessaie à l’accueil.");

    // mini délai pour éviter coupure audio quand on quitte l’écran
    await new Promise((r) => setTimeout(r, 350));

    await stopAllAudio();
    navigation.goBack();
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        await loadData(district, nearLatState, nearLngState, mode);

        if (mounted && (nearLatState == null || nearLngState == null)) {
          setStatusText("Localisation...");
          const coords = await getNearCoordsSafe(8000);
          if (!mounted) return;

          if (coords.nearLat != null && coords.nearLng != null) {
            setNearLatState(coords.nearLat);
            setNearLngState(coords.nearLng);
            setStatusText("");
            await loadData(district, coords.nearLat, coords.nearLng, mode);
          } else {
            setStatusText("Sans localisation (liste générale)");
          }
        }
      } catch {}
    })();

    return () => {
      mounted = false;
      Speech.stop();
      stopAllAudio().catch(() => {});
      try {
        webStream?.getTracks?.().forEach((t: any) => t.stop());
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district, intent]);

  const callPhone = async (phone?: string) => {
    if (!phone) return;
    const url = `tel:${phone.replace(/\s+/g, "")}`;
    const can = await Linking.canOpenURL(url);
    if (can) Linking.openURL(url);
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

  const tryHandleVoiceCommand = (text: string) => {
    const t = (text || "").toLowerCase();

    if (t.includes("retour") || t.includes("accueil") || t.includes("home")) {
      navigation.goBack();
      return true;
    }

    const m = t.match(/\b(appelle|appeler|call)\s+(\d+)\b/);
    if (m?.[2]) {
      const idx = parseInt(m[2], 10) - 1;
      if (!Number.isNaN(idx) && idx >= 0 && idx < items.length) {
        const target = items[idx] as any;
        if (target?.phone) callPhone(target.phone);
      }
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

    // ✅ PRE-WARM
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

    // coords
    let lat = nearLatState;
    let lng = nearLngState;
    if (lat == null || lng == null) {
      setStatusText("Localisation...");
      const coords = await getNearCoordsSafe(8000);
      lat = coords.nearLat;
      lng = coords.nearLng;
      setNearLatState(lat);
      setNearLngState(lng);
    }

    // ✅ 1) INTENT AUDIO d'abord
    let audioIntent: "PHARMACY" | "CLINIC" | "PHARMACY_ON_CALL" | "UNKNOWN" = "UNKNOWN";
    try {
      const resp = (await matchIntentFromAudio(uri)) as AudioIntentResp;
      audioIntent = pickClearAudioIntent(resp, { minConf: 0.62, minDelta: 0.08 }).intent;
    } catch {}

    if (audioIntent !== "UNKNOWN") {
      if (audioIntent === "PHARMACY_ON_CALL") {
        setStatusText("✅ Pharmacie de garde");
        await loadData(district, lat, lng, "oncall");
        return;
      }
      if (audioIntent === "CLINIC") {
        setStatusText("✅ Clinique");
        await loadData(district, lat, lng, "clinic");
        return;
      }
      if (audioIntent === "PHARMACY") {
        setStatusText("✅ Pharmacie");
        await loadData(district, lat, lng, "all");
        return;
      }
    }

    // ✅ 2) Sinon STT
    setStatusText("Reconnaissance STT…");
    const { text } = await sttFromAudio(uri);

    if (tryHandleVoiceCommand(text)) {
      setStatusText(`Commande: ${text}`);
      return;
    }

    if (!text || text.trim().length < 2) {
      await handleUnknownQuery();
      return;
    }

    setStatusText(`Reconnu: ${text}`);

    const { intent: newIntent, district: newDistrict } = routeQuery(text);

    if (newIntent === "PHARMACY_ON_CALL") {
      await loadData(newDistrict, lat, lng, "oncall");
      return;
    }

    if (newIntent === "PHARMACY") {
      await loadData(newDistrict, lat, lng, "all");
      return;
    }

    if (newIntent === "CLINIC") {
      await loadData(newDistrict, lat, lng, "clinic");
      return;
    }

    await handleUnknownQuery();
  };

  const onPressMic = async () => {
    try {
      await stopAllAudio();

      // ✅ WEB
      if (Platform.OS === "web") {
        if (!webRec) {
          setStatusText("J'écoute... (clique ⏹️ quand tu as fini)");

          const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true });
          setWebStream(stream);

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

              // coords
              let lat = nearLatState;
              let lng = nearLngState;
              if (lat == null || lng == null) {
                setStatusText("Localisation...");
                const coords = await getNearCoordsSafe(8000);
                lat = coords.nearLat;
                lng = coords.nearLng;
                setNearLatState(lat);
                setNearLngState(lng);
              }

              // ✅ 1) INTENT AUDIO d'abord
              let audioIntent: "PHARMACY" | "CLINIC" | "PHARMACY_ON_CALL" | "UNKNOWN" = "UNKNOWN";
              try {
                const resp = (await matchIntentFromBlob(blob)) as AudioIntentResp;
                audioIntent = pickClearAudioIntent(resp, { minConf: 0.62, minDelta: 0.08 }).intent;
              } catch {}

              if (audioIntent !== "UNKNOWN") {
                if (audioIntent === "PHARMACY_ON_CALL") {
                  setStatusText("✅ Pharmacie de garde");
                  await loadData(district, lat, lng, "oncall");
                  return;
                }
                if (audioIntent === "CLINIC") {
                  setStatusText("✅ Clinique");
                  await loadData(district, lat, lng, "clinic");
                  return;
                }
                if (audioIntent === "PHARMACY") {
                  setStatusText("✅ Pharmacie");
                  await loadData(district, lat, lng, "all");
                  return;
                }
              }

              // ✅ 2) Sinon STT
              setStatusText("Reconnaissance STT…");
              const { text } = await sttFromBlob(blob);

              if (tryHandleVoiceCommand(text)) {
                setStatusText(`Commande: ${text}`);
                return;
              }

              if (!text || text.trim().length < 2) {
                await handleUnknownQuery();
                return;
              }

              setStatusText(`Reconnu: ${text}`);

              const { intent: newIntent, district: newDistrict } = routeQuery(text);

              if (newIntent === "PHARMACY_ON_CALL") {
                await loadData(newDistrict, lat, lng, "oncall");
                return;
              }

              if (newIntent === "PHARMACY") {
                await loadData(newDistrict, lat, lng, "all");
                return;
              }

              if (newIntent === "CLINIC") {
                await loadData(newDistrict, lat, lng, "clinic");
                return;
              }

              await handleUnknownQuery();
            } catch (e: any) {
              console.error("MIC/WEB error:", e?.message || e);
              setStatusText("Erreur pendant l’enregistrement");
              await playUi("repeat_please");
            } finally {
              // ✅ STOP stream tracks (sinon micro reste actif)
              try {
                stream.getTracks().forEach((t: any) => t.stop());
              } catch {}
              setWebStream(null);

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

      // ✅ MOBILE
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
          <Text style={styles.title}>
            {intent === "CLINIC" ? "Cliniques" : intent === "PHARMACY_ON_CALL" ? "Pharmacies de garde" : "Pharmacies"}
          </Text>

          <Text style={styles.subtitle}>
            {hasCoords ? "Triées par distance (près de vous)" : district ? `Quartier: ${district}` : "Sans localisation (liste générale)"}
          </Text>

          <Text style={styles.query}>Requête: {queryText}</Text>
        </View>

        <Pressable onPress={onPressMic} style={[styles.micMini, isListening ? styles.micMiniActive : null]}>
          <Text style={styles.micMiniText}>{isListening ? "⏹️" : "🎙️"}</Text>
        </Pressable>
      </View>

      {statusText ? <Text style={styles.status}>{statusText}</Text> : null}

      {loading ? <Text style={styles.loading}>Chargement...</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !error ? (
        <FlatList
          data={items}
          keyExtractor={(it, idx) => `${(it as any).provider_id ?? (it as any).name}-${idx}`}
          contentContainerStyle={{ paddingBottom: 30 }}
          renderItem={({ item }) => {
            const distanceLine = (item as any).distance_km != null ? ` • ${(item as any).distance_km} km` : "";

            return (
              <Pressable onPress={() => speakNameOnly((item as any).name)} style={styles.card}>
                <Text style={styles.cardTitle}>{(item as any).name}</Text>

                <Text style={styles.cardText}>
                  {(item as any).district ? (item as any).district : ""}
                  {(item as any).city ? `${(item as any).district ? ", " : ""}${(item as any).city}` : ""}
                  {distanceLine}
                </Text>

                {(item as any).phone ? (
                  <Pressable
                    onPress={async () => {
                      await stopAllAudio();
                      callPhone((item as any).phone);
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
  micMiniActive: { borderColor: "#555" },
  micMiniText: { color: "#fff", fontSize: 18 },

  status: { color: "#bbb", textAlign: "center", marginTop: 6 },

  loading: { color: "#bbb", marginTop: 18, textAlign: "center" },
  error: { color: "#ff8a8a", marginTop: 12, textAlign: "center" },

  card: {
    backgroundColor: "#0b0b0b",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardText: { color: "#bbb", marginTop: 6 },
  cardMuted: { color: "#666", marginTop: 10 },

  callBtn: {
    marginTop: 10,
    backgroundColor: "#111",
    borderColor: "#333",
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  callText: { color: "#fff", fontWeight: "700" },
});
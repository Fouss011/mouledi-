import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, Linking, Platform } from "react-native";
import * as Speech from "expo-speech";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

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
} from "../lib/api";
import { routeQuery } from "../lib/nlu";

type Props = NativeStackScreenProps<RootStackParamList, "Results">;

/** --- UI AUDIO (mina) helper local --- */
let currentSound: Audio.Sound | null = null;
let playSeq = 0; // ✅ empêche les playUi concurrents

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
  const seq = ++playSeq; // ✅ ce playUi devient "le dernier"

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

export default function ResultsScreen({ navigation, route }: Props) {
  const { district, queryText, nearLat, nearLng, intent } = route.params as any;

  const [items, setItems] = useState<PharmacyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [statusText, setStatusText] = useState<string>("");

  const [webRec, setWebRec] = useState<MediaRecorder | null>(null);

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
    lat?: number,
    lng?: number,
    mode?: "oncall" | "clinic" | "all"
  ) => {
    setError(null);
    setLoading(true);

    const modeFinal = mode ?? "all";
    let res: PharmacyItem[] = [];

    if (modeFinal === "oncall") {
      res = await searchPharmaciesOnCall(d, lat, lng);
      if (res.length === 0) res = await searchPharmacies(d, lat, lng);
    } else if (modeFinal === "clinic") {
      res = await searchClinics(d, lat, lng);
      if (res.length === 0) {
        setItems([]);
        setLoading(false);
        await playUi("fallback_pharmacies_or_retry");
        return;
      }
    } else {
      res = await searchPharmacies(d, lat, lng);
    }

    setItems(res);
    setLoading(false);

    if (res.length > 0) {
      await playUi("tap_item_to_listen");
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!mounted) return;
        const mode = intent === "PHARMACY_ON_CALL" ? "oncall" : intent === "CLINIC" ? "clinic" : "all";
        await loadData(district, nearLat, nearLng, mode);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? "Erreur inconnue.");
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      Speech.stop();
      stopAllAudio().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district, nearLat, nearLng, intent]);

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
        const target = items[idx];
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

    setStatusText("Reconnaissance…");
    const { text } = await sttFromAudio(uri);

    if (tryHandleVoiceCommand(text)) {
      setStatusText(`Commande: ${text}`);
      return;
    }

    if (!text || text.trim().length < 2) {
      setStatusText("Répétez");
      await playUi("repeat_please");
      return;
    }

    setStatusText(`Reconnu: ${text}`);

    const { intent: newIntent, district: newDistrict } = routeQuery(text);

    if (newIntent === "PHARMACY_ON_CALL") {
      await loadData(newDistrict, nearLat, nearLng, "oncall");
      return;
    }

    if (newIntent === "PHARMACY") {
      await loadData(newDistrict, nearLat, nearLng, "all");
      return;
    }

    await playUi("fallback_pharmacies_or_retry");
    await loadData(null, nearLat, nearLng, "all");
  };

  const onPressMic = async () => {
    try {
      await stopAllAudio();

      // ✅ WEB
      if (Platform.OS === "web") {
        if (!webRec) {
          setStatusText("J'écoute...");

          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const rec = new MediaRecorder(stream);
          const chunks: BlobPart[] = [];

          rec.ondataavailable = (e) => {
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

              setStatusText("Reconnaissance…");
              const { text } = await sttFromBlob(blob);

              if (tryHandleVoiceCommand(text)) {
                setStatusText(`Commande: ${text}`);
                return;
              }

              if (!text || text.trim().length < 2) {
                setStatusText("Répétez");
                await playUi("repeat_please");
                return;
              }

              setStatusText(`Reconnu: ${text}`);

              const { intent: newIntent, district: newDistrict } = routeQuery(text);

              if (newIntent === "PHARMACY_ON_CALL") {
                await loadData(newDistrict, nearLat, nearLng, "oncall");
                return;
              }

              if (newIntent === "PHARMACY") {
                await loadData(newDistrict, nearLat, nearLng, "all");
                return;
              }

              if (newIntent === "CLINIC") {
                await loadData(newDistrict, nearLat, nearLng, "clinic");
                return;
              }

              await playUi("fallback_pharmacies_or_retry");
              await loadData(null, nearLat, nearLng, "all");
            } catch (e: any) {
              console.error("STT/WEB error:", e?.message || e);

              const msgRaw = String(e?.message || "");
              const msg =
                msgRaw.startsWith("STT error")
                  ? "Erreur de reconnaissance vocale (STT)"
                  : msgRaw.toLowerCase().includes("permission")
                  ? "Autorisation micro refusée"
                  : msgRaw.toLowerCase().includes("network") ||
                    msgRaw.toLowerCase().includes("fetch") ||
                    msgRaw.toLowerCase().includes("timeout") ||
                    e?.name === "AbortError"
                  ? "Problème de connexion / serveur"
                  : "Erreur pendant l’enregistrement";

              setStatusText(msg);
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

      // ✅ MOBILE
      if (recording) {
        await stopRecordingAndSearch(recording);
      } else {
        await startRecording();
      }
    } catch (e: any) {
      console.error("MIC flow error:", e?.message || e);
      setRecording(null);

      const msg =
        String(e?.message || "").toLowerCase().includes("permission")
          ? "Autorisation micro refusée"
          : String(e?.message || "").toLowerCase().includes("network") ||
            String(e?.message || "").toLowerCase().includes("fetch") ||
            String(e?.message || "").toLowerCase().includes("timeout") ||
            e?.name === "AbortError"
          ? "Problème de connexion / serveur"
          : "Erreur pendant l’enregistrement";

      setStatusText(msg);
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
            {intent === "CLINIC"
              ? "Cliniques"
              : intent === "PHARMACY_ON_CALL"
              ? "Pharmacies de garde"
              : "Pharmacies"}
          </Text>
          <Text style={styles.subtitle}>
            {nearLat != null && nearLng != null
              ? "Triées par distance (près de vous)"
              : district
              ? `Quartier: ${district}`
              : "Lomé"}
          </Text>
          <Text style={styles.query}>Requête: {queryText}</Text>
        </View>

        <Pressable onPress={onPressMic} style={[styles.micMini, recording ? styles.micMiniActive : null]}>
          <Text style={styles.micMiniText}>{recording ? "⏹️" : "🎙️"}</Text>
        </Pressable>
      </View>

      {statusText ? <Text style={styles.status}>{statusText}</Text> : null}

      {loading ? <Text style={styles.loading}>Chargement...</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !error ? (
        <FlatList
          data={items}
          keyExtractor={(it, idx) => `${it.provider_id ?? it.name}-${idx}`}
          contentContainerStyle={{ paddingBottom: 30 }}
          renderItem={({ item }) => {
            const distanceLine =
              (item as any).distance_km != null ? ` • ${(item as any).distance_km} km` : "";

            return (
              <Pressable onPress={() => speakNameOnly(item.name)} style={styles.card}>
                <Text style={styles.cardTitle}>{item.name}</Text>

                <Text style={styles.cardText}>
                  {item.district ? item.district : ""}
                  {item.city ? `${item.district ? ", " : ""}${item.city}` : ""}
                  {distanceLine}
                </Text>

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
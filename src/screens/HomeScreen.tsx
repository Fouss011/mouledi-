import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Platform } from "react-native";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { RootStackParamList } from "../../App";
import { routeQuery } from "../lib/nlu";
import { pingBackend, pingStt, sttFromAudio, sttFromBlob, BASE_URL, STT_URL } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

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
  // Ici on ne gère pas Speech dans Home (Home ne fait plus de TTS)
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

export default function HomeScreen({ navigation }: Props) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [statusText, setStatusText] = useState<string>("");

  // Debug (caché)
  const [debugMode, setDebugMode] = useState<boolean>(false);
  const [typed, setTyped] = useState<string>("pharmacie de garde a be");

  // fallback UI (si intent UNKNOWN)
  const [lastHeard, setLastHeard] = useState<string>("");
  const [showFallback, setShowFallback] = useState<boolean>(false);

  // --- WEB recorder ---
  const [webRec, setWebRec] = useState<MediaRecorder | null>(null);
  const [webChunks, setWebChunks] = useState<BlobPart[]>([]);

  // ✅ Géoloc robuste (web + mobile)
  const getNearCoords = async (): Promise<{ nearLat?: number; nearLng?: number }> => {
    try {
      // WEB
      if (Platform.OS === "web") {
        if (!navigator?.geolocation) return {};
        const res = await new Promise<{ nearLat?: number; nearLng?: number }>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ nearLat: pos.coords.latitude, nearLng: pos.coords.longitude }),
            () => resolve({}),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
          );
        });
        return res;
      }

      // MOBILE (Expo)
      const Location = await import("expo-location");
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return {};

      // Balanced = plus rapide/robuste que “Highest” dans beaucoup de téléphones
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return { nearLat: loc.coords.latitude, nearLng: loc.coords.longitude };
    } catch {
      return {};
    }
  };

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

  useEffect(() => {
    playUi("welcome");
    return () => {
      stopAllAudio().catch(() => {});
    };
  }, []);

  const startRecording = async () => {
    try {
      setShowFallback(false);
      setLastHeard("");
      setStatusText("J'écoute...");

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
      console.log("recording started");
      setStatusText("J'écoute...");
    } catch (e: any) {
      console.log("startRecording error =", e?.name, e?.message || e);
      setRecording(null);
      setStatusText("Erreur enregistrement micro");
      await playUi("repeat_please");
    }
  };

  const stopRecordingAndProcess = async (rec: Audio.Recording) => {
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

    // ✅ PRE-WARM (Fly cold start)
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

    if (!text || text.trim().length < 2) {
      setStatusText("Répétez");
      await playUi("repeat_please");
      return;
    }

    setLastHeard(text);
    setStatusText(`Reconnu: ${text}`);

    const { intent, district } = routeQuery(text);

    // ✅ Récupère la géoloc AVANT navigation
    setStatusText("Localisation…");
    const { nearLat, nearLng } = await getNearCoords();

    if (intent === "PHARMACY_ON_CALL") {
      await stopAllAudio();
      navigation.navigate("Results", {
        queryText: text,
        intent: "PHARMACY_ON_CALL",
        district,
        nearLat,
        nearLng,
      });
      return;
    }

    if (intent === "PHARMACY") {
      await stopAllAudio();
      navigation.navigate("Results", {
        queryText: text,
        intent: "PHARMACY",
        district,
        nearLat,
        nearLng,
      });
      return;
    }

    if (intent === "CLINIC") {
      await stopAllAudio();
      navigation.navigate("Results", {
        queryText: text,
        intent: "CLINIC",
        district,
        nearLat,
        nearLng,
      });
      return;
    }

    setShowFallback(true);
    await playUi("fallback_pharmacies_or_retry");
  };

  const onPressMic = async () => {
    try {
      await stopAllAudio();

      // ✅ WEB
      if (Platform.OS === "web") {
        if (!webRec) {
          setShowFallback(false);
          setLastHeard("");
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

              if (!text || text.trim().length < 2) {
                setStatusText("Répétez");
                await playUi("repeat_please");
                return;
              }

              setLastHeard(text);
              setStatusText(`Reconnu: ${text}`);

              const { intent, district } = routeQuery(text);

              // ✅ Géoloc WEB avant navigate
              setStatusText("Localisation…");
              const { nearLat, nearLng } = await getNearCoords();

              if (intent === "PHARMACY_ON_CALL") {
                await stopAllAudio();
                navigation.navigate("Results", {
                  queryText: text,
                  intent: "PHARMACY_ON_CALL",
                  district,
                  nearLat,
                  nearLng,
                });
                return;
              }

              if (intent === "PHARMACY") {
                await stopAllAudio();
                navigation.navigate("Results", {
                  queryText: text,
                  intent: "PHARMACY",
                  district,
                  nearLat,
                  nearLng,
                });
                return;
              }

              if (intent === "CLINIC") {
                await stopAllAudio();
                navigation.navigate("Results", {
                  queryText: text,
                  intent: "CLINIC",
                  district,
                  nearLat,
                  nearLng,
                });
                return;
              }

              setShowFallback(true);
              await playUi("fallback_pharmacies_or_retry");
            } catch (e: any) {
              console.error("STT/WEB error:", e?.message || e);

              const msg =
                e?.name === "AbortError"
                  ? "Le serveur met trop de temps (timeout)"
                  : String(e?.message || "").includes("STT error")
                  ? "Erreur de reconnaissance vocale"
                  : "Problème de connexion / serveur";

              setStatusText(msg);
              await playUi("repeat_please");
            } finally {
              setWebRec(null);
              setWebChunks([]);
            }
          };

          rec.start();
          setWebChunks(chunks);
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
        await stopRecordingAndProcess(recording);
      } else {
        await startRecording();
      }
    } catch (e: any) {
      console.error("MIC flow error:", e?.message || e);
      setRecording(null);

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
    }
  };

  const goPharmacies = async () => {
    // ✅ Même le fallback doit envoyer la position
    setStatusText("Localisation…");
    const { nearLat, nearLng } = await getNearCoords();

    navigation.navigate("Results", {
      queryText: lastHeard || "pharmacie",
      intent: "PHARMACY",
      district: null,
      nearLat,
      nearLng,
    });
  };

  const onDebugGo = async () => {
    const { intent, district } = routeQuery(typed);
    setStatusText(`DEBUG: intent=${intent} | district=${district ?? "null"}`);

    // ✅ Debug récupère aussi la position (web + mobile)
    const { nearLat, nearLng } = await getNearCoords();

    if (intent === "PHARMACY_ON_CALL") {
      navigation.navigate("Results", { queryText: typed, intent: "PHARMACY_ON_CALL", district, nearLat, nearLng });
      return;
    }

    if (intent === "PHARMACY") {
      navigation.navigate("Results", { queryText: typed, intent: "PHARMACY", district, nearLat, nearLng });
      return;
    }

    if (intent === "CLINIC") {
      navigation.navigate("Results", { queryText: typed, intent: "CLINIC", district, nearLat, nearLng });
      return;
    }

    setShowFallback(true);
    playUi("fallback_pharmacies_or_retry").catch(() => {});
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MOULÉDI</Text>
      <Text style={styles.subtitle}>Toucher → Parler → Écouter → Agir</Text>
      <Text style={{ color: "#444", fontSize: 11, marginTop: 6 }}>API: {BASE_URL}</Text>
      <Text style={{ color: "#444", fontSize: 11, marginTop: 6 }}>STT: {STT_URL}</Text>

      <View style={styles.center}>
        <Pressable style={[styles.micButton, recording ? styles.micActive : null]} onPress={onPressMic}>
          <Text style={styles.micText}>{recording ? "⏹️" : "🎙️"}</Text>
        </Pressable>

        <Text style={styles.hint}>
          {recording ? "Enregistrement..." : "Appuie pour parler, puis ré-appuie pour valider."}
        </Text>

        {statusText ? <Text style={styles.status}>{statusText}</Text> : null}

        {showFallback ? (
          <View style={styles.fallbackBox}>
            <Text style={styles.fallbackTitle}>Je peux quand même t’aider :</Text>

            <Pressable onPress={goPharmacies} style={styles.fallbackBtn}>
              <Text style={styles.fallbackText}>Voir pharmacies</Text>
            </Pressable>

            <Pressable onPress={onPressMic} style={[styles.fallbackBtn, { marginTop: 10 }]}>
              <Text style={styles.fallbackText}>Réessayer au micro</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={() => setDebugMode((v) => !v)} style={styles.debugToggle}>
          <Text style={styles.debugToggleText}>{debugMode ? "Masquer debug" : "Mode debug"}</Text>
        </Pressable>

        {debugMode ? (
          <>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder="Ex: pharmacie de garde a be"
              placeholderTextColor="#777"
              style={styles.input}
            />
            <Pressable onPress={onDebugGo} style={styles.debugBtn}>
              <Text style={styles.debugText}>Tester avec le texte</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", paddingTop: 64, paddingHorizontal: 20 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: 4 },
  subtitle: { color: "#bbb", marginTop: 6, fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },

  micButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#222",
  },
  micActive: { borderColor: "#555" },
  micText: { fontSize: 48 },

  hint: { color: "#ddd", textAlign: "center", marginTop: 6 },
  status: { color: "#bbb", textAlign: "center", marginTop: 6 },

  fallbackBox: {
    width: "100%",
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#0b0b0b",
  },
  fallbackTitle: { color: "#fff", fontWeight: "700", marginBottom: 10 },
  fallbackBtn: {
    width: "100%",
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  fallbackText: { color: "#fff", fontWeight: "700" },

  debugToggle: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#0b0b0b",
  },
  debugToggleText: { color: "#aaa", fontSize: 12, fontWeight: "600" },

  input: {
    width: "100%",
    backgroundColor: "#0b0b0b",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    marginTop: 10,
  },
  debugBtn: {
    width: "100%",
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  debugText: { color: "#fff", fontWeight: "700" },
});
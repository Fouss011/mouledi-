// src/screens/HomeScreen.tsx
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Platform } from "react-native";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Location from "expo-location";

import { RootStackParamList } from "../../App";
import { routeQuery } from "../lib/nlu";
import {
  pingBackend,
  pingStt,
  sttFromAudio,
  sttFromBlob,
  matchIntentFromAudio,
  matchIntentFromBlob,
  BASE_URL,
  STT_URL,
} from "../lib/api";

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

  // MOBILE (Expo)
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

/** ✅ Pick intent audio ONLY si clair (delta gate) */
function pickClearAudioIntent(
  resp: { intent?: string; confidence?: number; scores?: { intent: string; score: number }[] } | null | undefined,
  deltaMin = 0.18,
  minConfFallback = 0.35
): { intent: string; confidence: number; isClear: boolean; delta?: number } {
  const intent = resp?.intent ?? "UNKNOWN";
  const confidence = Number(resp?.confidence ?? 0);
  const scores = resp?.scores;

  if (!Array.isArray(scores) || scores.length < 2) {
    const isClear = intent !== "UNKNOWN" && confidence >= minConfFallback;
    return { intent, confidence, isClear };
  }

  const top = Number(scores[0]?.score ?? 0);
  const second = Number(scores[1]?.score ?? 0);
  const delta = top - second;

  const isClear = intent !== "UNKNOWN" && delta >= deltaMin;
  return { intent, confidence, isClear, delta };
}

export default function HomeScreen({ navigation }: Props) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [statusText, setStatusText] = useState<string>("");

  // Debug (caché)
  const [debugMode, setDebugMode] = useState<boolean>(false);
  const [typed, setTyped] = useState<string>("pharmacie");

  // fallback UI (si intent UNKNOWN)
  const [lastHeard, setLastHeard] = useState<string>("");
  const [showFallback, setShowFallback] = useState<boolean>(false);

  // --- WEB recorder ---
  const [webRec, setWebRec] = useState<MediaRecorder | null>(null);
  const [webChunks, setWebChunks] = useState<BlobPart[]>([]);
  // ✅ IMPORTANT: garder le stream pour le stopper (sinon micro reste actif)
  const [webStream, setWebStream] = useState<any>(null);

  // ✅ UI listening state (WEB uses webRec, MOBILE uses recording)
  const isListening = Platform.OS === "web" ? !!webRec : !!recording;

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
      try {
        webStream?.getTracks?.().forEach((t: any) => t.stop());
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setStatusText("J'écoute...");
    } catch (e: any) {
      console.log("startRecording error =", e?.name, e?.message || e);
      setRecording(null);
      setStatusText("Erreur enregistrement micro");
      await playUi("repeat_please");
    }
  };

  const navigateByIntent = async (
    finalIntent: string,
    text: string,
    district: string | null,
    nearLat: number | null,
    nearLng: number | null
  ) => {
    if (finalIntent === "PHARMACY_ON_CALL") {
      await stopAllAudio();
      navigation.navigate("Results", { queryText: text || "pharmacie de garde", intent: "PHARMACY_ON_CALL", district, nearLat, nearLng });
      return true;
    }

    if (finalIntent === "PHARMACY") {
      await stopAllAudio();
      navigation.navigate("Results", { queryText: text || "pharmacie", intent: "PHARMACY", district, nearLat, nearLng });
      return true;
    }

    if (finalIntent === "CLINIC") {
      await stopAllAudio();
      navigation.navigate("Results", { queryText: text || "clinique", intent: "CLINIC", district, nearLat, nearLng });
      return true;
    }

    return false;
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

    // ✅ AUDIO FIRST
    setStatusText("Compréhension audio…");
    let audioResp: any = null;

    try {
      audioResp = await matchIntentFromAudio(uri, 0.0);
      console.log("[AUDIO_INTENT raw]", audioResp);
    } catch (e: any) {
      console.log("[AUDIO_INTENT] error:", e?.message || e);
    }

    const picked = pickClearAudioIntent(audioResp, 0.18, 0.35);
    let audioIntent = picked.intent;

    if (picked.delta != null) {
      console.log("[AUDIO_INTENT] picked=", audioIntent, "conf=", picked.confidence, "delta=", picked.delta, "clear=", picked.isClear);
    } else {
      console.log("[AUDIO_INTENT] picked=", audioIntent, "conf=", picked.confidence, "clear=", picked.isClear);
    }

    // ✅ STT seulement si audio pas clair
    let text = "";
    if (!picked.isClear) {
      setStatusText("Reconnaissance…");
      try {
        const stt = await sttFromAudio(uri);
        text = stt?.text ?? "";
      } catch (e: any) {
        console.log("[STT] error:", e?.message || e);
        text = "";
      }
    }

    if (text && text.trim().length >= 2) {
      setLastHeard(text);
      setStatusText(`Reconnu: ${text}`);
    } else {
      setLastHeard("");
      setStatusText(audioIntent !== "UNKNOWN" ? `Compris (audio): ${audioIntent}` : "Répétez");
    }

    // District vient du texte si dispo
    const routed = text && text.trim().length >= 2 ? routeQuery(text) : { intent: "UNKNOWN", district: null as any };
    const district = (routed as any)?.district ?? null;

    // Localisation
    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);

    // Décision finale
    const finalIntent = picked.isClear ? audioIntent : (routed as any)?.intent ?? "UNKNOWN";

    const ok = await navigateByIntent(finalIntent, text, district, nearLat, nearLng);
    if (!ok) {
      setShowFallback(true);
      await playUi("fallback_pharmacies_or_retry");
    }
  };

  const onPressMic = async () => {
    try {
      await stopAllAudio();

      // ✅ WEB
      if (Platform.OS === "web") {
        if (!webRec) {
          setShowFallback(false);
          setLastHeard("");
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

              // ✅ AUDIO FIRST (WEB)
              setStatusText("Compréhension audio…");
              let audioResp: any = null;

              try {
                audioResp = await matchIntentFromBlob(blob, 0.0);
                console.log("[AUDIO_INTENT raw]", audioResp);
              } catch (e: any) {
                console.log("[AUDIO_INTENT] error:", e?.message || e);
              }

              const picked = pickClearAudioIntent(audioResp, 0.18, 0.35);
              let audioIntent = picked.intent;

              // ✅ STT seulement si audio pas clair
              let text = "";
              if (!picked.isClear) {
                setStatusText("Reconnaissance…");
                try {
                  const stt = await sttFromBlob(blob);
                  text = stt?.text ?? "";
                } catch (e: any) {
                  console.log("[STT] error:", e?.message || e);
                  text = "";
                }
              }

              if (text && text.trim().length >= 2) {
                setLastHeard(text);
                setStatusText(`Reconnu: ${text}`);
              } else {
                setLastHeard("");
                setStatusText(audioIntent !== "UNKNOWN" ? `Compris (audio): ${audioIntent}` : "Répétez");
              }

              const routed = text && text.trim().length >= 2 ? routeQuery(text) : { intent: "UNKNOWN", district: null as any };
              const district = (routed as any)?.district ?? null;

              setStatusText("Localisation...");
              const { nearLat, nearLng } = await getNearCoordsSafe(8000);

              const finalIntent = picked.isClear ? audioIntent : (routed as any)?.intent ?? "UNKNOWN";

              const ok = await navigateByIntent(finalIntent, text, district, nearLat, nearLng);
              if (!ok) {
                setShowFallback(true);
                await playUi("fallback_pharmacies_or_retry");
              }
            } catch (e: any) {
              console.error("WEB flow error:", e?.message || e);

              const msg =
                e?.name === "AbortError"
                  ? "Le serveur met trop de temps (timeout)"
                  : String(e?.message || "").includes("STT error")
                  ? "Erreur de reconnaissance vocale"
                  : String(e?.message || "").includes("Intent match error")
                  ? "Erreur de compréhension audio"
                  : "Problème de connexion / serveur";

              setStatusText(msg);
              await playUi("repeat_please");
            } finally {
              // ✅ STOP stream tracks (sinon micro reste actif)
              try {
                stream.getTracks().forEach((t: any) => t.stop());
              } catch {}
              setWebStream(null);

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
          : msgRaw.startsWith("Intent match error")
          ? "Erreur compréhension audio"
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
    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);

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

    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);

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
        <Pressable style={[styles.micButton, isListening ? styles.micActive : null]} onPress={onPressMic}>
          <Text style={styles.micText}>{isListening ? "⏹️" : "🎙️"}</Text>
        </Pressable>

        <Text style={styles.hint}>
          {isListening ? "Enregistrement..." : "Appuie pour parler, puis ré-appuie pour valider."}
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
              placeholder="Ex: pharmacie de garde"
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
import React, { useEffect, useMemo, useRef, useState } from "react";
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
let playSeq = 0; // empêche les playUi concurrents

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

async function setPlaybackMode() {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
  } catch {}
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

    await setPlaybackMode();

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

export default function HomeScreen({ navigation, route }: Props) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [statusText, setStatusText] = useState<string>("");

  // Debug (caché)
  const [debugMode, setDebugMode] = useState<boolean>(false);
  const [typed, setTyped] = useState<string>("pharmacie");

  // fallback UI (si intent UNKNOWN)
  const [showFallback, setShowFallback] = useState<boolean>(false);

  // WEB recorder
  const [webRec, setWebRec] = useState<MediaRecorder | null>(null);

  // ✅ UI: listening state correct (mobile + web)
  const isListening = useMemo(() => recording != null || webRec != null, [recording, webRec]);

  // anti spam “astuce” (pas obligé)
  const lastCoachRef = useRef<number>(0);
  const maybeCoachWakeWord = async () => {
    const now = Date.now();
    if (now - lastCoachRef.current < 45_000) return; // max 1 fois / 45s
    lastCoachRef.current = now;
    // await playUi("say_mouledi_command");
  };

  useEffect(() => {
    setPlaybackMode().catch(() => {});
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
      navigation.navigate("Results", {
        queryText: text || "pharmacie de garde",
        intent: "PHARMACY_ON_CALL",
        district,
        nearLat,
        nearLng,
      });
      return true;
    }

    if (finalIntent === "PHARMACY") {
      await stopAllAudio();
      navigation.navigate("Results", {
        queryText: text || "pharmacie",
        intent: "PHARMACY",
        district,
        nearLat,
        nearLng,
      });
      return true;
    }

    if (finalIntent === "CLINIC") {
      await stopAllAudio();
      navigation.navigate("Results", {
        queryText: text || "clinique",
        intent: "CLINIC",
        district,
        nearLat,
        nearLng,
      });
      return true;
    }

    return false;
  };

  // ✅ fallback soft (icônes) -> aucun texte obligatoire
  const openPharmacies = async () => {
    setShowFallback(false);
    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);
    navigation.navigate("Results", {
      queryText: "pharmacie",
      intent: "PHARMACY",
      district: null,
      nearLat,
      nearLng,
    });
  };

  const openClinics = async () => {
    setShowFallback(false);
    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);
    navigation.navigate("Results", {
      queryText: "clinique",
      intent: "CLINIC",
      district: null,
      nearLat,
      nearLng,
    });
  };

  const stopRecordingAndProcess = async (rec: Audio.Recording) => {
    setStatusText("Traitement...");
    await rec.stopAndUnloadAsync();
    setRecording(null);

    // ✅ IMPORTANT: remettre mode playback sinon TTS/UI audio peut être muet
    await setPlaybackMode();

    const st = await rec.getStatusAsync();
    const ms = (st as any)?.durationMillis ?? 0;
    if (ms < 900) {
      setStatusText("Répétez");
      await playUi("repeat_please");
      return;
    }

    const uri = rec.getURI();
    if (!uri) {
      setStatusText("Erreur audio");
      await playUi("repeat_please");
      return;
    }

    // PRE-WARM
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

    // AUDIO FIRST
    setStatusText("Compréhension audio…");
    let audioResp: any = null;
    try {
      audioResp = await matchIntentFromAudio(uri, 0.0);
    } catch {}

    const picked = pickClearAudioIntent(audioResp, 0.18, 0.35);
    const audioIntent = picked.intent;

    // STT seulement si audio pas clair (pour quartier, etc.)
    let text = "";
    if (!picked.isClear) {
      setStatusText("Reconnaissance…");
      try {
        const stt = await sttFromAudio(uri);
        text = stt?.text ?? "";
      } catch {
        text = "";
      }
    }

    // SOFT wake-word: si l’utilisateur dit juste "pharmacie" -> on exécute, mais on coach
    const t = (text || "").toLowerCase();
    const hasWake = t.includes("moul");
    const looksPharmacy = t.includes("pharm") || t.includes("médic") || t.includes("medic");
    const looksClinic = t.includes("clini") || t.includes("hop") || t.includes("hôp") || t.includes("centre de santé") || t.includes("santé");
    const looksOnCall = t.includes("garde") || t.includes("urgence");

    // district vient du texte si dispo
    const routed = text && text.trim().length >= 2 ? routeQuery(text) : { intent: "UNKNOWN", district: null as any };
    const district = (routed as any)?.district ?? null;

    // localisation
    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);

    // 1) intent audio clair => direct
    const finalIntent = picked.isClear ? audioIntent : (routed as any)?.intent ?? "UNKNOWN";

    // 2) SOFT: si pas clair mais mots FR détectés
    if (!picked.isClear && finalIntent === "UNKNOWN") {
      if (looksOnCall) {
        if (!hasWake) await maybeCoachWakeWord();
        await navigateByIntent("PHARMACY_ON_CALL", text, district, nearLat, nearLng);
        return;
      }
      if (looksClinic) {
        if (!hasWake) await maybeCoachWakeWord();
        await navigateByIntent("CLINIC", text, district, nearLat, nearLng);
        return;
      }
      if (looksPharmacy) {
        if (!hasWake) await maybeCoachWakeWord();
        await navigateByIntent("PHARMACY", text, district, nearLat, nearLng);
        return;
      }
    }

    const ok = await navigateByIntent(finalIntent, text, district, nearLat, nearLng);
    if (!ok) {
      setShowFallback(true);
      await playUi("fallback_pharmacies_or_retry");
      setStatusText("Choisis Pharmacie ou Clinique, ou réessaie au micro.");
    }
  };

  const onPressMic = async () => {
    try {
      await stopAllAudio();

      // WEB
      if (Platform.OS === "web") {
        if (!webRec) {
          setShowFallback(false);
          setStatusText("J'écoute...");

          const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true });
          const rec = new MediaRecorder(stream);
          const chunks: BlobPart[] = [];

          rec.ondataavailable = (e: any) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };

          rec.onstop = async () => {
            try {
              setWebRec(null);
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

              // AUDIO FIRST
              setStatusText("Compréhension audio…");
              let audioResp: any = null;
              try {
                audioResp = await matchIntentFromBlob(blob, 0.0);
              } catch {}

              const picked = pickClearAudioIntent(audioResp, 0.18, 0.35);
              const audioIntent = picked.intent;

              // STT seulement si audio pas clair
              let text = "";
              if (!picked.isClear) {
                setStatusText("Reconnaissance…");
                try {
                  const stt = await sttFromBlob(blob);
                  text = stt?.text ?? "";
                } catch {
                  text = "";
                }
              }

              const t = (text || "").toLowerCase();
              const hasWake = t.includes("moul");
              const looksPharmacy = t.includes("pharm") || t.includes("médic") || t.includes("medic");
              const looksClinic = t.includes("clini") || t.includes("hop") || t.includes("hôp") || t.includes("centre de santé") || t.includes("santé");
              const looksOnCall = t.includes("garde") || t.includes("urgence");

              const routed = text && text.trim().length >= 2 ? routeQuery(text) : { intent: "UNKNOWN", district: null as any };
              const district = (routed as any)?.district ?? null;

              setStatusText("Localisation...");
              const { nearLat, nearLng } = await getNearCoordsSafe(8000);

              const finalIntent = picked.isClear ? audioIntent : (routed as any)?.intent ?? "UNKNOWN";

              if (!picked.isClear && finalIntent === "UNKNOWN") {
                if (looksOnCall) {
                  if (!hasWake) await maybeCoachWakeWord();
                  await navigateByIntent("PHARMACY_ON_CALL", text, district, nearLat, nearLng);
                  return;
                }
                if (looksClinic) {
                  if (!hasWake) await maybeCoachWakeWord();
                  await navigateByIntent("CLINIC", text, district, nearLat, nearLng);
                  return;
                }
                if (looksPharmacy) {
                  if (!hasWake) await maybeCoachWakeWord();
                  await navigateByIntent("PHARMACY", text, district, nearLat, nearLng);
                  return;
                }
              }

              const ok = await navigateByIntent(finalIntent, text, district, nearLat, nearLng);
              if (!ok) {
                setShowFallback(true);
                await playUi("fallback_pharmacies_or_retry");
                setStatusText("Choisis Pharmacie ou Clinique, ou réessaie au micro.");
              }
            } catch (e: any) {
              setWebRec(null);
              setStatusText("Erreur connexion / serveur");
              await playUi("repeat_please");
            }
          };

          rec.start();
          setWebRec(rec);
          return;
        } else {
          setStatusText("Traitement...");
          webRec.stop();
          return;
        }
      }

      // MOBILE
      if (recording) {
        await stopRecordingAndProcess(recording);
      } else {
        await startRecording();
      }
    } catch (e: any) {
      setRecording(null);
      setWebRec(null);
      setStatusText("Erreur micro");
      await playUi("repeat_please");
    }
  };

  // ✅ CHANGEMENT: autoStartMic quand on vient de ResultsScreen (reset)
  useEffect(() => {
    const auto = (route as any)?.params?.autoStartMic;
    if (!auto) return;

    // Important: on vide le texte + on lance le mic après un mini delay (évite glitch navigation)
    setStatusText("");
    const t = setTimeout(() => {
      onPressMic().catch(() => {});
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(route as any)?.params?.autoStartMic]);

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
          {isListening ? "Enregistrement... (appuie STOP quand tu as fini)" : "Appuie pour parler, puis ré-appuie pour valider."}
        </Text>

        {/* ✅ exemples de commandes (guidance) */}
        <View style={styles.voiceExamples}>
          <Text style={styles.voiceTitle}>Dis par exemple :</Text>
          <Text style={styles.voiceCmd}>• Moulédji pharmacie</Text>
          <Text style={styles.voiceCmd}>• Moulédji clinique</Text>
        </View>

        {statusText ? <Text style={styles.status}>{statusText}</Text> : null}

        {/* ✅ fallback avec icônes + micro */}
        {showFallback ? (
          <View style={styles.choiceBox}>
            <Text style={styles.choiceTitle}>Je peux te proposer :</Text>

            <View style={styles.choiceRow}>
              <Pressable onPress={openPharmacies} style={styles.choiceCard}>
                <Text style={styles.choiceIcon}>💊</Text>
                <Text style={styles.choiceText}>Pharmacies</Text>
              </Pressable>

              <Pressable onPress={openClinics} style={styles.choiceCard}>
                <Text style={styles.choiceIcon}>🏥</Text>
                <Text style={styles.choiceText}>Cliniques</Text>
              </Pressable>
            </View>

            <Pressable onPress={onPressMic} style={[styles.choiceMicBtn]}>
              <Text style={styles.choiceMicText}>Réessayer 🎙️</Text>
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

  voiceExamples: { marginTop: 6, alignItems: "center" },
  voiceTitle: { color: "#888", fontSize: 13, marginBottom: 4 },
  voiceCmd: { color: "#fff", fontSize: 15, fontWeight: "600", marginTop: 2 },

  choiceBox: {
    width: "100%",
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#0b0b0b",
  },
  choiceTitle: { color: "#fff", fontWeight: "800", marginBottom: 10 },
  choiceRow: { flexDirection: "row", gap: 12 },
  choiceCard: {
    flex: 1,
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceIcon: { fontSize: 34, marginBottom: 6 },
  choiceText: { color: "#fff", fontWeight: "800" },
  choiceMicBtn: {
    marginTop: 12,
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  choiceMicText: { color: "#fff", fontWeight: "800" },

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
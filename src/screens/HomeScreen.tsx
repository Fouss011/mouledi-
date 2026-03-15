import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Platform } from "react-native";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Location from "expo-location";

import { RootStackParamList } from "../../App";
import {
  pingBackend,
  pingStt,
  sttFromAudio,
  sttFromBlob,
  matchIntentFromAudio,
  matchIntentFromBlob,
  BASE_URL,
} from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

type UserLang = "mina" | "kabyè" | "fr" | "mute";
type DirectIntent =
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

function mapUiLang(lang: UserLang): "mina" | "fr" | "kabyè" {
  if (lang === "mute") return "fr";
  return lang;
}

async function playUi(key: string, lang: UserLang = "mina") {
  if (lang === "mute") return;

  const seq = ++playSeq;
  try {
    await stopAllAudio();

    const effectiveLang = mapUiLang(lang);

    const r = await fetch(
      `${BASE_URL}/health/ui-audio?key=${encodeURIComponent(key)}&lang=${encodeURIComponent(effectiveLang)}`
    );
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

async function getNearCoordsSafe(
  timeoutMs = 8000
): Promise<{ nearLat: number | null; nearLng: number | null }> {
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

function normalizeIntent(i?: string): DirectIntent {
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
  resp: { intent?: string; confidence?: number; scores?: { intent: string; score: number }[] } | null | undefined,
  deltaMin = 0.18,
  minConfFallback = 0.35
): { intent: DirectIntent; confidence: number; isClear: boolean; delta?: number } {
  const intent = normalizeIntent(resp?.intent);
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

function guessIntentFromText(text: string): DirectIntent {
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

export default function HomeScreen({ navigation, route }: Props) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [debugMode, setDebugMode] = useState<boolean>(false);
  const [typed, setTyped] = useState<string>("pharmacie");
  const [showFallback, setShowFallback] = useState<boolean>(false);
  const [webRec, setWebRec] = useState<MediaRecorder | null>(null);
  const [selectedLang, setSelectedLang] = useState<UserLang>("mina");
  const [showLangPicker, setShowLangPicker] = useState<boolean>(
    !(route.params?.skipLanguagePicker ?? false)
  );
  const [hasPlayedWelcome, setHasPlayedWelcome] = useState<boolean>(false);
  const [titleTapCount, setTitleTapCount] = useState<number>(0);
  const [showHiddenAccess, setShowHiddenAccess] = useState<boolean>(false);

  const isListening = useMemo(() => recording != null || webRec != null, [recording, webRec]);

  const lastCoachRef = useRef<number>(0);
  const maybeCoachWakeWord = async () => {
    const now = Date.now();
    if (now - lastCoachRef.current < 45_000) return;
    lastCoachRef.current = now;
  };

  useEffect(() => {
    if (route.params?.skipLanguagePicker) {
      setShowLangPicker(false);
    }
  }, [route.params?.skipLanguagePicker]);

  useEffect(() => {
    setPlaybackMode().catch(() => {});
  }, []);

  useEffect(() => {
    const skip = route.params?.skipLanguagePicker ?? false;
    const auto = route.params?.autoStartMic ?? false;

    if (showLangPicker || skip || auto) {
      return;
    }

    if (!hasPlayedWelcome) {
      playUi("welcome", selectedLang).catch(() => {});
      setHasPlayedWelcome(true);
    }

    return () => {
      stopAllAudio().catch(() => {});
    };
  }, [
    showLangPicker,
    selectedLang,
    hasPlayedWelcome,
    route.params?.skipLanguagePicker,
    route.params?.autoStartMic,
  ]);

  const handleTitlePress = () => {
    const next = titleTapCount + 1;
    setTitleTapCount(next);
    if (next >= 5) {
      setShowHiddenAccess(true);
      setTitleTapCount(0);
    }
  };

  const chooseLanguage = async (lang: UserLang) => {
    await stopAllAudio();
    setSelectedLang(lang);
    setShowLangPicker(false);
    setStatusText("");
    setHasPlayedWelcome(false);
  };

  const startRecording = async () => {
    try {
      setShowFallback(false);
      setStatusText("J'écoute...");

      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setStatusText("Permission micro refusée.");
        await playUi("repeat_please", selectedLang);
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
    } catch {
      setRecording(null);
      setStatusText("Erreur enregistrement micro");
      await playUi("repeat_please", selectedLang);
    }
  };

  const navigateByIntent = async (
    finalIntent: DirectIntent,
    text: string,
    nearLat: number | null,
    nearLng: number | null
  ) => {
    if (finalIntent === "PHARMACY_ON_CALL") {
      await stopAllAudio();
      navigation.navigate("Results", {
        queryText: text || "pharmacie de garde",
        intent: "PHARMACY_ON_CALL",
        district: null,
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
        district: null,
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
        district: null,
        nearLat,
        nearLng,
      });
      return true;
    }

    if (finalIntent === "RESTAURANT") {
      await stopAllAudio();
      navigation.navigate("Results", {
        queryText: text || "restaurant",
        intent: "RESTAURANT",
        district: null,
        nearLat,
        nearLng,
      });
      return true;
    }

    if (finalIntent === "PASSPORT") {
      await stopAllAudio();
      navigation.navigate("Guide", {
        guideKey: "passport",
        lang: selectedLang === "mute" ? "fr" : selectedLang,
      });
      return true;
    }

    if (finalIntent === "CNI") {
      await stopAllAudio();
      navigation.navigate("Guide", {
        guideKey: "cni",
        lang: selectedLang === "mute" ? "fr" : selectedLang,
      });
      return true;
    }

    return false;
  };

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

  const openRestaurants = async () => {
    setShowFallback(false);
    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);
    navigation.navigate("Results", {
      queryText: "restaurant",
      intent: "RESTAURANT",
      district: null,
      nearLat,
      nearLng,
    });
  };

  const stopRecordingAndProcess = async (rec: Audio.Recording) => {
    setStatusText("Traitement...");
    await rec.stopAndUnloadAsync();
    setRecording(null);

    await setPlaybackMode();

    const st = await rec.getStatusAsync();
    const ms = (st as any)?.durationMillis ?? 0;
    if (ms < 900) {
      setStatusText("Répétez");
      await playUi("repeat_please", selectedLang);
      return;
    }

    const uri = rec.getURI();
    if (!uri) {
      setStatusText("Erreur audio");
      await playUi("repeat_please", selectedLang);
      return;
    }

    setStatusText("Réveil serveur…");
    const okApi = await pingBackend();
    const okStt = await pingStt();

    if (!okApi) {
      setStatusText("Backend indisponible");
      await playUi("repeat_please", selectedLang);
      return;
    }
    if (!okStt) {
      setStatusText("Assistance vocale indisponible");
      await playUi("repeat_please", selectedLang);
      return;
    }

    setStatusText("Compréhension audio…");
    let audioResp: any = null;
    try {
      audioResp = await matchIntentFromAudio(uri, 0.0);
    } catch {}

    const picked = pickClearAudioIntent(audioResp, 0.18, 0.35);

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

    const t = (text || "").toLowerCase();
    const hasWake = t.includes("moul");

    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);

    let finalIntent: DirectIntent = picked.isClear ? picked.intent : "UNKNOWN";

    if (finalIntent === "UNKNOWN" && text.trim().length >= 2) {
      finalIntent = guessIntentFromText(text);
    }

    if (finalIntent === "UNKNOWN") {
      if (!hasWake) await maybeCoachWakeWord();
      setShowFallback(true);
      await playUi("fallback_pharmacies_or_retry", selectedLang);
      setStatusText("Choisis Pharmacie, Clinique, Restaurant ou réessaie au micro.");
      return;
    }

    const ok = await navigateByIntent(finalIntent, text, nearLat, nearLng);
    if (!ok) {
      setShowFallback(true);
      await playUi("fallback_pharmacies_or_retry", selectedLang);
      setStatusText("Choisis Pharmacie, Clinique, Restaurant ou réessaie au micro.");
    }
  };

  const onPressMic = async () => {
    try {
      await stopAllAudio();

      if (showLangPicker) return;

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
                await playUi("repeat_please", selectedLang);
                return;
              }
              if (!okStt) {
                setStatusText("Assistance vocale indisponible");
                await playUi("repeat_please", selectedLang);
                return;
              }

              setStatusText("Compréhension audio…");
              let audioResp: any = null;
              try {
                audioResp = await matchIntentFromBlob(blob, 0.0);
              } catch {}

              const picked = pickClearAudioIntent(audioResp, 0.18, 0.35);

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

              setStatusText("Localisation...");
              const { nearLat, nearLng } = await getNearCoordsSafe(8000);

              let finalIntent: DirectIntent = picked.isClear ? picked.intent : "UNKNOWN";

              if (finalIntent === "UNKNOWN" && text.trim().length >= 2) {
                finalIntent = guessIntentFromText(text);
              }

              if (finalIntent === "UNKNOWN") {
                if (!hasWake) await maybeCoachWakeWord();
                setShowFallback(true);
                await playUi("fallback_pharmacies_or_retry", selectedLang);
                setStatusText("Choisis Pharmacie, Clinique, Restaurant ou réessaie au micro.");
                return;
              }

              const ok = await navigateByIntent(finalIntent, text, nearLat, nearLng);
              if (!ok) {
                setShowFallback(true);
                await playUi("fallback_pharmacies_or_retry", selectedLang);
                setStatusText("Choisis Pharmacie, Clinique, Restaurant ou réessaie au micro.");
              }
            } catch {
              setWebRec(null);
              setStatusText("Erreur connexion / serveur");
              await playUi("repeat_please", selectedLang);
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

      if (recording) {
        await stopRecordingAndProcess(recording);
      } else {
        await startRecording();
      }
    } catch {
      setRecording(null);
      setWebRec(null);
      setStatusText("Erreur micro");
      await playUi("repeat_please", selectedLang);
    }
  };

  useEffect(() => {
    const auto = route?.params?.autoStartMic;
    if (!auto || showLangPicker) return;

    setStatusText("");
    const t = setTimeout(async () => {
      await stopAllAudio();
      onPressMic().catch(() => {});
    }, 250);

    return () => clearTimeout(t);
  }, [route?.params?.autoStartMic, showLangPicker]);

  const onDebugGo = async () => {
    const intent = guessIntentFromText(typed);
    setStatusText(`DEBUG: intent=${intent}`);

    if (intent === "UNKNOWN") {
      setShowFallback(true);
      playUi("fallback_pharmacies_or_retry", selectedLang).catch(() => {});
      return;
    }

    setStatusText("Localisation...");
    const { nearLat, nearLng } = await getNearCoordsSafe(8000);
    await navigateByIntent(intent, typed, nearLat, nearLng);
  };

  if (showLangPicker) {
    return (
      <View style={styles.container}>
        <Pressable onPress={handleTitlePress}>
          <Text style={styles.title}>MOULÉDI</Text>
        </Pressable>
        <Text style={styles.subtitle}>Choisis ta langue</Text>

        <View style={styles.langBox}>
          <Pressable style={styles.langBtn} onPress={() => chooseLanguage("mina")}>
            <Text style={styles.langBtnText}>Mina</Text>
          </Pressable>

          <Pressable style={styles.langBtn} onPress={() => chooseLanguage("kabyè")}>
            <Text style={styles.langBtnText}>Kabyè</Text>
          </Pressable>

          <Pressable style={styles.langBtn} onPress={() => chooseLanguage("fr")}>
            <Text style={styles.langBtnText}>Français</Text>
          </Pressable>

          <Pressable style={styles.langBtn} onPress={() => chooseLanguage("mute")}>
            <Text style={styles.langBtnText}>Mode muet</Text>
          </Pressable>
        </View>

        {showHiddenAccess ? (
          <View style={styles.bottomLinks}>
            <Pressable onPress={() => navigation.navigate("CollectProvider")} style={styles.collectBtn}>
              <Text style={styles.collectText}>Accès enquêteur</Text>
            </Pressable>

            <Pressable onPress={() => navigation.navigate("AdminReview")} style={styles.collectBtn}>
              <Text style={styles.collectText}>Admin validation</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable onPress={handleTitlePress}>
        <Text style={styles.title}>MOULÉDI</Text>
      </Pressable>
      <Text style={styles.subtitle}>Toucher → Parler → Écouter → Agir</Text>

      <View style={styles.center}>
        <Pressable style={[styles.micButton, isListening ? styles.micActive : null]} onPress={onPressMic}>
          <Text style={styles.micText}>{isListening ? "⏹️" : "🎙️"}</Text>
        </Pressable>

        <Text style={styles.hint}>
          {isListening ? "Enregistrement... (appuie STOP quand tu as fini)" : "Appuie pour parler, puis ré-appuie pour valider."}
        </Text>

        <View style={styles.voiceExamples}>
          <Text style={styles.voiceTitle}>Dis par exemple :</Text>
          <Text style={styles.voiceCmd}>• Moulédji pharmacie</Text>
          <Text style={styles.voiceCmd}>• Moulédji clinique</Text>
          <Text style={styles.voiceCmd}>• Moulédji restaurant</Text>
          <Text style={styles.voiceCmd}>• Moulédji passeport</Text>
          <Text style={styles.voiceCmd}>• Moulédji carte d’identité</Text>
        </View>

        {statusText ? <Text style={styles.status}>{statusText}</Text> : null}

        {showFallback ? (
          <View style={styles.choiceBox}>
            <Text style={styles.choiceTitle}>Je peux te proposer :</Text>

            <View style={styles.choiceColumn}>
              <Pressable onPress={openPharmacies} style={styles.choiceCard}>
                <Text style={styles.choiceIcon}>💊</Text>
                <Text style={styles.choiceText}>Pharmacies</Text>
              </Pressable>

              <Pressable onPress={openClinics} style={styles.choiceCard}>
                <Text style={styles.choiceIcon}>🏥</Text>
                <Text style={styles.choiceText}>Cliniques</Text>
              </Pressable>

              <Pressable onPress={openRestaurants} style={styles.choiceCard}>
                <Text style={styles.choiceIcon}>🍽️</Text>
                <Text style={styles.choiceText}>Restaurants</Text>
              </Pressable>
            </View>

            <Pressable onPress={onPressMic} style={styles.choiceMicBtn}>
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
              placeholder="Ex: passeport"
              placeholderTextColor="#777"
              style={styles.input}
            />
            <Pressable onPress={onDebugGo} style={styles.debugBtn}>
              <Text style={styles.debugText}>Tester avec le texte</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {showHiddenAccess ? (
        <View style={styles.bottomLinks}>
          <Pressable onPress={() => navigation.navigate("CollectProvider")} style={styles.collectBtn}>
            <Text style={styles.collectText}>Accès enquêteur</Text>
          </Pressable>

          <Pressable onPress={() => navigation.navigate("AdminReview")} style={styles.collectBtn}>
            <Text style={styles.collectText}>Admin validation</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", paddingTop: 64, paddingHorizontal: 20 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: 4 },
  subtitle: { color: "#bbb", marginTop: 6, fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },

  langBox: {
    marginTop: 40,
    gap: 12,
  },
  langBtn: {
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  langBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  micButton: {
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#222",
    marginVertical: 10,
  },
  micActive: { borderColor: "#555" },
  micText: { fontSize: 76 },

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
  choiceColumn: { gap: 12 },
  choiceCard: {
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

  bottomLinks: {
    gap: 10,
    marginBottom: 20,
  },
  collectBtn: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#0b0b0b",
  },
  collectText: {
    color: "#777",
    fontSize: 12,
  },
});
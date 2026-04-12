import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  Platform,
  Animated,
  Easing,
  ScrollView,
  ImageBackground,
  SafeAreaView,
} from "react-native";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Location from "expo-location";
import {
  Feather,
  MaterialCommunityIcons,
  Ionicons,
  FontAwesome5,
} from "@expo/vector-icons";

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
      `${BASE_URL}/health/ui-audio?key=${encodeURIComponent(key)}&lang=${encodeURIComponent(
        effectiveLang
      )}`
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
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof navigator !== "undefined") {
    const nav = navigator as any;

    if (!window.isSecureContext) {
      console.log("Geolocation unavailable: insecure context");
      return { nearLat: null, nearLng: null };
    }

    if (!nav.geolocation) {
      console.log("Geolocation unavailable: navigator.geolocation missing");
      return { nearLat: null, nearLng: null };
    }

    const getPosition = (
      options: PositionOptions
    ): Promise<{ nearLat: number | null; nearLng: number | null }> =>
      new Promise((resolve) => {
        let done = false;

        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          resolve({ nearLat: null, nearLng: null });
        }, timeoutMs);

        nav.geolocation.getCurrentPosition(
          (pos: GeolocationPosition) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({
              nearLat: pos.coords.latitude,
              nearLng: pos.coords.longitude,
            });
          },
          (err: GeolocationPositionError) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            console.log("Geolocation error:", err.code, err.message);
            resolve({ nearLat: null, nearLng: null });
          },
          options
        );
      });

    const quick = await getPosition({
      enableHighAccuracy: false,
      timeout: Math.min(timeoutMs, 6000),
      maximumAge: 120000,
    });

    if (quick.nearLat != null && quick.nearLng != null) {
      return quick;
    }

    const precise = await getPosition({
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 0,
    });

    return precise;
  }

  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { nearLat: null, nearLng: null };

    const locPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );

    const loc = (await Promise.race([locPromise, timeoutPromise])) as any;
    if (!loc?.coords) return { nearLat: null, nearLng: null };

    return {
      nearLat: loc.coords.latitude,
      nearLng: loc.coords.longitude,
    };
  } catch (e) {
    console.log("Location native error:", e);
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

  const looksPassport = t.includes("passeport") || t.includes("passport");

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

  const looksPharmacy = t.includes("pharm") || t.includes("médic") || t.includes("medic");

  if (looksPassport) return "PASSPORT";
  if (looksCni) return "CNI";
  if (looksOnCall) return "PHARMACY_ON_CALL";
  if (looksClinic) return "CLINIC";
  if (looksRestaurant) return "RESTAURANT";
  if (looksPharmacy) return "PHARMACY";
  return "UNKNOWN";
}

function getStatusLabel(statusText: string, isListening: boolean) {
  if (isListening) return "J’écoute...";
  if (!statusText) return "Appuie pour parler";
  return statusText;
}

const COLORS = {
  bg: "#F5EFE6",
  overlay: "rgba(245,239,230,0.93)",
  card: "rgba(255,255,255,0.86)",
  cardStrong: "#FFFDF9",
  cardSoft: "rgba(255,255,255,0.58)",
  border: "rgba(80,50,20,0.08)",
  borderStrong: "rgba(80,50,20,0.16)",
  text: "#2F241C",
  textSoft: "#6B5B4D",
  textMuted: "#8A796A",
  primary: "#B96A32",
  primaryDark: "#8F4D22",
  primarySoft: "rgba(185,106,50,0.12)",
  primaryUltraSoft: "rgba(185,106,50,0.06)",
  shadow: "rgba(0,0,0,0.08)",
  white: "#FFFFFF",
  whiteSoft: "rgba(255,255,255,0.78)",
  disabledBg: "rgba(255,255,255,0.45)",
};

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
  const [lastShortcutTouched, setLastShortcutTouched] = useState<string | null>(null);

  const isListening = useMemo(() => recording != null || webRec != null, [recording, webRec]);

  const pulse = useRef(new Animated.Value(1)).current;
  const halo = useRef(new Animated.Value(0.35)).current;
  const glow = useRef(new Animated.Value(0.55)).current;

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

    if (showLangPicker || skip || auto) return;

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

  useEffect(() => {
    let running: Animated.CompositeAnimation | null = null;

    if (isListening) {
      running = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulse, {
              toValue: 1.06,
              duration: 850,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulse, {
              toValue: 1,
              duration: 850,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(halo, {
              toValue: 0.88,
              duration: 850,
              useNativeDriver: true,
            }),
            Animated.timing(halo, {
              toValue: 0.35,
              duration: 850,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(glow, {
              toValue: 0.95,
              duration: 850,
              useNativeDriver: true,
            }),
            Animated.timing(glow, {
              toValue: 0.55,
              duration: 850,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      running.start();
    } else {
      Animated.parallel([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(halo, {
          toValue: 0.35,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.55,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }

    return () => {
      if (running) running.stop();
    };
  }, [isListening, pulse, halo, glow]);

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
      setStatusText("J’écoute...");

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
      setStatusText("J’écoute...");
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

  const handleShortcutPress = async (
  key: string,
  label: string,
  action: () => Promise<void> | void
) => {
  if (lastShortcutTouched !== key) {
    setLastShortcutTouched(key);

    try {
      const utterance =
        Platform.OS === "web"
          ? new SpeechSynthesisUtterance(label)
          : null;

      if (utterance && typeof window !== "undefined" && window.speechSynthesis) {
        utterance.lang = "fr-FR";
        utterance.rate = 0.92;
        utterance.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    } catch {}

    setTimeout(() => {
      setLastShortcutTouched((prev) => (prev === key ? null : prev));
    }, 3000);

    return;
  }

  setLastShortcutTouched(null);
  await action();
};

  const openPassportGuide = async () => {
    await stopAllAudio();
    navigation.navigate("Guide", {
      guideKey: "passport",
      lang: selectedLang === "mute" ? "fr" : selectedLang,
    });
  };

  const openCniGuide = async () => {
    await stopAllAudio();
    navigation.navigate("Guide", {
      guideKey: "cni",
      lang: selectedLang === "mute" ? "fr" : selectedLang,
    });
  };

  const openSoonGuide = async (label: string) => {
    await stopAllAudio();
    setStatusText(`${label} bientôt disponible`);
  };

  const stopRecordingAndProcess = async (rec: Audio.Recording) => {
    setStatusText("Traitement...");
    await rec.stopAndUnloadAsync();
    setRecording(null);

    await setPlaybackMode();

    const st = await rec.getStatusAsync();
    const ms = (st as any)?.durationMillis ?? 0;
    if (ms < 900) {
      setStatusText("Répète s’il te plaît");
      await playUi("repeat_please", selectedLang);
      return;
    }

    const uri = rec.getURI();
    if (!uri) {
      setStatusText("Erreur audio");
      await playUi("repeat_please", selectedLang);
      return;
    }

    setStatusText("Connexion...");
    const okApi = await pingBackend();
    const okStt = await pingStt();

    if (!okApi) {
      setStatusText("Service indisponible");
      await playUi("repeat_please", selectedLang);
      return;
    }
    if (!okStt) {
      setStatusText("Voix indisponible");
      await playUi("repeat_please", selectedLang);
      return;
    }

    setStatusText("Compréhension...");
    let audioResp: any = null;
    try {
      audioResp = await matchIntentFromAudio(uri, 0.0);
    } catch {}

    const picked = pickClearAudioIntent(audioResp, 0.18, 0.35);

    let text = "";
    if (!picked.isClear) {
      setStatusText("Reconnaissance...");
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
      setStatusText("Choisis une suggestion ou réessaie.");
      return;
    }

    const ok = await navigateByIntent(finalIntent, text, nearLat, nearLng);
    if (!ok) {
      setShowFallback(true);
      await playUi("fallback_pharmacies_or_retry", selectedLang);
      setStatusText("Choisis une suggestion ou réessaie.");
    }
  };

  const onPressMic = async () => {
    try {
      await stopAllAudio();

      if (showLangPicker) return;

      if (Platform.OS === "web") {
        if (!webRec) {
          setShowFallback(false);
          setStatusText("J’écoute...");

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

              setStatusText("Connexion...");
              const okApi = await pingBackend();
              const okStt = await pingStt();

              if (!okApi) {
                setStatusText("Service indisponible");
                await playUi("repeat_please", selectedLang);
                return;
              }
              if (!okStt) {
                setStatusText("Voix indisponible");
                await playUi("repeat_please", selectedLang);
                return;
              }

              setStatusText("Compréhension...");
              let audioResp: any = null;
              try {
                audioResp = await matchIntentFromBlob(blob, 0.0);
              } catch {}

              const picked = pickClearAudioIntent(audioResp, 0.18, 0.35);

              let text = "";
              if (!picked.isClear) {
                setStatusText("Reconnaissance...");
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
                setStatusText("Choisis une suggestion ou réessaie.");
                return;
              }

              const ok = await navigateByIntent(finalIntent, text, nearLat, nearLng);
              if (!ok) {
                setShowFallback(true);
                await playUi("fallback_pharmacies_or_retry", selectedLang);
                setStatusText("Choisis une suggestion ou réessaie.");
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

  const statusLabel = getStatusLabel(statusText, isListening);
  const showDebugToggle = __DEV__;

  if (showLangPicker) {
    return (
      <ImageBackground
        source={require("../assets/mouledi-bg.png")}
        style={styles.background}
        resizeMode="cover"
        imageStyle={styles.bgImage}
      >
        <View style={styles.overlay} />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.container}>
            <View style={styles.langScreenTop}>
              <Pressable onPress={handleTitlePress}>
                <Text style={styles.brandTitle}>MOULÉDI</Text>
              </Pressable>

              <Text style={styles.langHeading}>Choisis ta langue</Text>
              <Text style={styles.langLead}>Une expérience vocale simple, claire et rapide.</Text>
            </View>

            <View style={styles.langGrid}>
              <Pressable style={styles.langCard} onPress={() => chooseLanguage("mina")}>
                <View style={styles.langIconBox}>
                  <MaterialCommunityIcons name="account-voice" size={24} color={COLORS.primaryDark} />
                </View>
                <View style={styles.langTextBox}>
                  <Text style={styles.langTitle}>Mina</Text>
                  <Text style={styles.langDesc}>Mode vocal en mina</Text>
                </View>
              </Pressable>

              <Pressable style={styles.langCard} onPress={() => chooseLanguage("kabyè")}>
                <View style={styles.langIconBox}>
                  <MaterialCommunityIcons name="account-voice" size={24} color={COLORS.primaryDark} />
                </View>
                <View style={styles.langTextBox}>
                  <Text style={styles.langTitle}>Kabyè</Text>
                  <Text style={styles.langDesc}>Mode vocal en kabyè</Text>
                </View>
              </Pressable>

              <Pressable style={styles.langCard} onPress={() => chooseLanguage("fr")}>
                <View style={styles.langIconBox}>
                  <Ionicons name="language" size={24} color={COLORS.primaryDark} />
                </View>
                <View style={styles.langTextBox}>
                  <Text style={styles.langTitle}>Français</Text>
                  <Text style={styles.langDesc}>Mode standard</Text>
                </View>
              </Pressable>

              <Pressable style={styles.langCard} onPress={() => chooseLanguage("mute")}>
                <View style={styles.langIconBox}>
                  <Feather name="volume-x" size={22} color={COLORS.primaryDark} />
                </View>
                <View style={styles.langTextBox}>
                  <Text style={styles.langTitle}>Mode muet</Text>
                  <Text style={styles.langDesc}>Sans lecture audio</Text>
                </View>
              </Pressable>
            </View>

            {showHiddenAccess ? (
              <View style={styles.bottomLinks}>
                <Pressable
                  onPress={() => navigation.navigate("CollectProvider")}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostBtnText}>Accès enquêteur</Text>
                </Pressable>

                <Pressable
                  onPress={() => navigation.navigate("AdminReview")}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostBtnText}>Admin validation</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </SafeAreaView>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground
      source={require("../assets/mouledi-bg.png")}
      style={styles.background}
      resizeMode="cover"
      imageStyle={styles.bgImage}
    >
      <View style={styles.overlay} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.topBar}>
            <View style={styles.brandBlock}>
              <Pressable onPress={handleTitlePress}>
                <Text style={styles.brandTitle}>MOULÉDI</Text>
              </Pressable>
            </View>

            <Pressable style={styles.langPill} onPress={() => setShowLangPicker(true)}>
              <Text style={styles.langPillText}>
                {selectedLang === "mute"
                  ? "MUET"
                  : selectedLang === "fr"
                  ? "FR"
                  : selectedLang === "mina"
                  ? "MINA"
                  : "KABYÈ"}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>Recherche vocale</Text>

              <View style={styles.micZone}>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.micHaloOuter,
                    {
                      opacity: halo,
                      transform: [{ scale: pulse }],
                    },
                  ]}
                />
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.micHaloInner,
                    {
                      opacity: glow,
                      transform: [{ scale: pulse }],
                    },
                  ]}
                />

                <Pressable onPress={onPressMic} style={styles.micButtonWrap}>
                  <Animated.View
                    style={[
                      styles.micButton,
                      isListening ? styles.micButtonActive : null,
                      { transform: [{ scale: pulse }] },
                    ]}
                  >
                    {isListening ? (
                      <Ionicons name="stop" size={40} color={COLORS.white} />
                    ) : (
                      <MaterialCommunityIcons
                        name="microphone"
                        size={54}
                        color={COLORS.white}
                      />
                    )}
                  </Animated.View>
                </Pressable>
              </View>

              <Text style={styles.heroStatus}>{statusLabel}</Text>
              <Text style={styles.heroHint}>
                {isListening
                  ? "Parle puis appuie encore pour envoyer."
                  : "Exemple : “Moulédi pharmacie”"}
              </Text>

              <Pressable onPress={onPressMic} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>{isListening ? "Arrêter" : "Commencer"}</Text>
              </Pressable>
            </View>

            <View style={styles.quickCard}>
  <Text style={styles.sectionTitle}>Démarches utiles</Text>

  <View style={styles.quickGridTwoRows}>
    <Pressable style={styles.quickItem} onPress={() =>
  handleShortcutPress("passport", "Passeport", openPassportGuide)
}>
      <View style={styles.quickIconWrap}>
        <MaterialCommunityIcons
          name="passport"
          size={20}
          color={COLORS.primaryDark}
        />
      </View>
      <Text style={styles.quickText}>Passeport</Text>
      <Text style={styles.quickSubtext}>Guide pratique</Text>
    </Pressable>

    <Pressable style={styles.quickItem} onPress={() =>
  handleShortcutPress(
    "cni",
    "Carte d'identité",
    openCniGuide
  )
}>
      <View style={styles.quickIconWrap}>
        <MaterialCommunityIcons
          name="card-account-details-outline"
          size={20}
          color={COLORS.primaryDark}
        />
      </View>
      <Text style={styles.quickText}>Carte d’identité</Text>
      <Text style={styles.quickSubtext}>Documents utiles</Text>
    </Pressable>

    <Pressable
      style={[styles.quickItem, styles.quickItemDisabled]}
      onPress={() =>
  handleShortcutPress(
    "birth",
    "Acte de naissance",
    () => openSoonGuide("Acte de naissance")
  )
}
    >
      <View style={styles.quickIconWrap}>
        <Ionicons
          name="document-text-outline"
          size={20}
          color={COLORS.primaryDark}
        />
      </View>
      <Text style={styles.quickText}>Acte de naissance</Text>
      <Text style={styles.quickSubtext}>Bientôt disponible</Text>
    </Pressable>

    <Pressable
      style={[styles.quickItem, styles.quickItemDisabled]}
      onPress={() =>
  handleShortcutPress(
    "nationality",
    "Certificat de nationalité",
    () => openSoonGuide("Certificat de nationalité")
  )
}
    >
      <View style={styles.quickIconWrap}>
        <Feather
          name="file-text"
          size={20}
          color={COLORS.primaryDark}
        />
      </View>
      <Text style={styles.quickText}>Certificat de nationalité</Text>
      <Text style={styles.quickSubtext}>Bientôt disponible</Text>
    </Pressable>
  </View>
</View>

            <View style={styles.quickCard}>
              <Text style={styles.sectionTitle}>Services à proximité</Text>

              <View style={styles.quickGrid}>
                <Pressable
  style={styles.quickItem}
  onPress={() =>
    handleShortcutPress("pharmacy", "Pharmacie", openPharmacies)
  }
>
                  <View style={styles.quickIconWrap}>
                    <FontAwesome5 name="pills" size={18} color={COLORS.primaryDark} />
                  </View>
                  <Text style={styles.quickText}>Pharmacie</Text>
                  <Text style={styles.quickSubtext}>À proximité</Text>
                </Pressable>

                <Pressable
  style={styles.quickItem}
  onPress={() =>
    handleShortcutPress("clinic", "Clinique", openClinics)
  }
>
                  <View style={styles.quickIconWrap}>
                    <MaterialCommunityIcons
                      name="hospital-building"
                      size={22}
                      color={COLORS.primaryDark}
                    />
                  </View>
                  <Text style={styles.quickText}>Clinique</Text>
                  <Text style={styles.quickSubtext}>Autour de toi</Text>
                </Pressable>

                <Pressable
  style={styles.quickItem}
  onPress={() =>
    handleShortcutPress("restaurant", "Restaurant", openRestaurants)
  }
>
                  <View style={styles.quickIconWrap}>
                    <MaterialCommunityIcons
                      name="silverware-fork-knife"
                      size={22}
                      color={COLORS.primaryDark}
                    />
                  </View>
                  <Text style={styles.quickText}>Restaurant</Text>
                  <Text style={styles.quickSubtext}>Près de toi</Text>
                </Pressable>
              </View>
            </View>

            {statusText ? (
              <View style={styles.statusCard}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>{statusText}</Text>
              </View>
            ) : null}

            {showFallback ? (
              <View style={styles.choiceBox}>
                <Text style={styles.sectionTitle}>Suggestions</Text>

                <View style={styles.choiceColumn}>
                  <Pressable onPress={openPharmacies} style={styles.choiceCard}>
                    <View style={styles.choiceIconWrap}>
                      <FontAwesome5 name="pills" size={16} color={COLORS.primaryDark} />
                    </View>
                    <Text style={styles.choiceText}>Pharmacies proches</Text>
                  </Pressable>

                  <Pressable onPress={openClinics} style={styles.choiceCard}>
                    <View style={styles.choiceIconWrap}>
                      <MaterialCommunityIcons
                        name="hospital-building"
                        size={18}
                        color={COLORS.primaryDark}
                      />
                    </View>
                    <Text style={styles.choiceText}>Cliniques proches</Text>
                  </Pressable>

                  <Pressable onPress={openRestaurants} style={styles.choiceCard}>
                    <View style={styles.choiceIconWrap}>
                      <MaterialCommunityIcons
                        name="silverware-fork-knife"
                        size={18}
                        color={COLORS.primaryDark}
                      />
                    </View>
                    <Text style={styles.choiceText}>Restaurants proches</Text>
                  </Pressable>
                </View>

                <Pressable onPress={onPressMic} style={styles.secondaryBtn}>
                  <Feather name="mic" size={16} color={COLORS.primaryDark} />
                  <Text style={styles.secondaryBtnText}>Réessayer au micro</Text>
                </Pressable>
              </View>
            ) : null}

            {showDebugToggle ? (
              <>
                <Pressable onPress={() => setDebugMode((v) => !v)} style={styles.debugToggle}>
                  <Text style={styles.debugToggleText}>
                    {debugMode ? "Masquer debug" : "Mode développeur"}
                  </Text>
                </Pressable>

                {debugMode ? (
                  <View style={styles.debugCard}>
                    <TextInput
                      value={typed}
                      onChangeText={setTyped}
                      placeholder="Ex : passeport"
                      placeholderTextColor={COLORS.textMuted}
                      style={styles.input}
                    />
                    <Pressable onPress={onDebugGo} style={styles.debugBtn}>
                      <Text style={styles.debugText}>Tester avec le texte</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}

            {showHiddenAccess ? (
              <View style={styles.bottomLinks}>
                <Pressable
                  onPress={() => navigation.navigate("CollectProvider")}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostBtnText}>Accès enquêteur</Text>
                </Pressable>

                <Pressable
                  onPress={() => navigation.navigate("AdminReview")}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostBtnText}>Admin validation</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  bgImage: {
    opacity: 0.08,
    transform: [{ scale: 1.08 }],
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },

  safeArea: {
    flex: 1,
  },

  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: 28,
  },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },

  brandBlock: {
    flex: 1,
    paddingRight: 12,
  },

  brandTitle: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  langPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.whiteSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },

  langPillText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  heroCard: {
  backgroundColor: COLORS.card,
  borderRadius: 30,
  borderWidth: 1,
  borderColor: COLORS.border,
  paddingVertical: 28,
  paddingHorizontal: 20,
  marginBottom: 16,
  alignItems: "center",
  shadowColor: "#000",
  shadowOpacity: 0.08,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 5,
},

  heroEyebrow: {
    color: COLORS.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 16,
  },

  micZone: {
  width: "100%",
  minHeight: 235,
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 12,
},

  micHaloOuter: {
  position: "absolute",
  width: 204,
  height: 204,
  borderRadius: 999,
  backgroundColor: COLORS.primaryUltraSoft,
  borderWidth: 1,
  borderColor: "rgba(185,106,50,0.10)",
},

  micHaloInner: {
  position: "absolute",
  width: 166,
  height: 166,
  borderRadius: 999,
  backgroundColor: "rgba(255,255,255,0.46)",
  borderWidth: 1,
  borderColor: "rgba(185,106,50,0.08)",
},

  micButtonWrap: {
    alignItems: "center",
    justifyContent: "center",
  },

  micButton: {
  width: 136,
  height: 136,
  borderRadius: 999,
  backgroundColor: COLORS.primary,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 4,
  borderColor: "rgba(255,255,255,0.66)",
  zIndex: 2,
  shadowColor: "#000",
  shadowOpacity: 0.14,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
  elevation: 7,
},

  micButtonActive: {
    backgroundColor: COLORS.primaryDark,
  },

  heroStatus: {
  color: COLORS.text,
  fontSize: 19,
  fontWeight: "800",
  textAlign: "center",
  marginBottom: 8,
},

  heroHint: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 20,
  },

  primaryBtn: {
    minWidth: 190,
    backgroundColor: COLORS.primary,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  primaryBtnText: {
    color: COLORS.white,
    fontWeight: "800",
    fontSize: 16,
  },

  quickCard: {
  backgroundColor: COLORS.card,
  borderRadius: 24,
  borderWidth: 1,
  borderColor: COLORS.border,
  padding: 16,
  marginBottom: 14,
},

  sectionTitle: {
  color: COLORS.text,
  fontSize: 20,
  fontWeight: "900",
  marginBottom: 14,
},

  quickGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },

  quickGridTwoRows: {
  flexDirection: "row",
  flexWrap: "wrap",
  justifyContent: "space-between",
  rowGap: 12,
  columnGap: 10,
},

  quickItem: {
  width: "48%",
  minHeight: 148,
  backgroundColor: COLORS.cardSoft,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: COLORS.border,
  alignItems: "center",
  justifyContent: "flex-start",
  paddingHorizontal: 12,
  paddingVertical: 16,
},

  quickItemDisabled: {
    backgroundColor: COLORS.disabledBg,
  },

  quickIconWrap: {
  width: 56,
  height: 56,
  borderRadius: 16,
  backgroundColor: COLORS.primarySoft,
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 12,
},

  quickText: {
  color: COLORS.text,
  fontSize: 15,
  fontWeight: "800",
  textAlign: "center",
  lineHeight: 20,
  minHeight: 40,
},

  quickSubtext: {
  color: COLORS.textMuted,
  fontSize: 12,
  marginTop: 6,
  textAlign: "center",
  lineHeight: 16,
  minHeight: 32,
},

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.whiteSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: COLORS.primary,
    marginRight: 10,
  },

  statusText: {
    flex: 1,
    color: COLORS.text,
    fontWeight: "700",
  },

  choiceBox: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginBottom: 16,
  },

  choiceColumn: {
    gap: 10,
  },

  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.cardSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },

  choiceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.primarySoft,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  choiceText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
  },

  secondaryBtn: {
    marginTop: 16,
    backgroundColor: COLORS.primarySoft,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },

  secondaryBtnText: {
    color: COLORS.primaryDark,
    fontWeight: "800",
    fontSize: 15,
  },

  debugToggle: {
    alignSelf: "center",
    marginTop: 2,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: "rgba(255,255,255,0.35)",
  },

  debugToggleText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },

  debugCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
  },

  input: {
    width: "100%",
    backgroundColor: COLORS.cardSoft,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.text,
    marginBottom: 12,
  },

  debugBtn: {
    width: "100%",
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.borderStrong,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },

  debugText: {
    color: COLORS.primaryDark,
    fontWeight: "800",
  },

  langScreenTop: {
    marginTop: 12,
    marginBottom: 24,
  },

  langHeading: {
    color: COLORS.text,
    marginTop: 14,
    fontSize: 24,
    fontWeight: "900",
  },

  langLead: {
    color: COLORS.textSoft,
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
  },

  langGrid: {
    marginTop: 8,
    gap: 14,
  },

  langCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },

  langIconBox: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: COLORS.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  langTextBox: {
    flex: 1,
  },

  langTitle: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 17,
    marginBottom: 4,
  },

  langDesc: {
    color: COLORS.textSoft,
    fontSize: 13,
    lineHeight: 18,
  },

  bottomLinks: {
    gap: 10,
    marginTop: 12,
    marginBottom: 16,
  },

  ghostBtn: {
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: "rgba(255,255,255,0.42)",
  },

  ghostBtnText: {
    color: COLORS.textSoft,
    fontSize: 12,
    fontWeight: "700",
  },
});
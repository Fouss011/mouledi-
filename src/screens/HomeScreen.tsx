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
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

const ANDROID_TOP = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 8 : 0;

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
  if (!statusText) return "Appuie sur le micro";
  return statusText;
}

const COLORS = {
  bg: "#F4EDE1",
  overlay: "rgba(244,237,225,0.78)",
  surface: "rgba(255,250,243,0.90)",
  surfaceStrong: "rgba(255,248,239,0.96)",
  surfaceSoft: "rgba(255,255,255,0.36)",
  line: "rgba(95,67,37,0.10)",
  lineStrong: "rgba(95,67,37,0.18)",
  text: "#2F2418",
  textSoft: "#5E4B38",
  textMuted: "#8E7760",
  accent: "#B5622E",
  accentDark: "#8E4A21",
  accentSoft: "#EED7C2",
  successSoft: "rgba(181,98,46,0.10)",
  statusBg: "rgba(255,250,243,0.82)",
  darkPill: "rgba(255,248,239,0.88)",
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
              toValue: 0.9,
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

  if (showLangPicker) {
    return (
      <ImageBackground
        source={require("../assets/mouledi-bg.png")}
        style={styles.background}
        resizeMode="cover"
      >
        <View style={styles.overlay} />
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
          <View style={styles.container}>
            <View style={styles.langScreenTop}>
              <Pressable onPress={handleTitlePress}>
                <Text style={styles.brandTitle}>MOULÉDI</Text>
              </Pressable>
              <Text style={styles.langHeading}>Choisis ta langue</Text>
              <Text style={styles.langLead}>Simple. Vocal. Rapide.</Text>
            </View>

            <View style={styles.langGrid}>
              <Pressable style={styles.langCard} onPress={() => chooseLanguage("mina")}>
                <View style={styles.langIconBox}>
                  <Text style={styles.langEmoji}>🗣️</Text>
                </View>
                <View style={styles.langTextBox}>
                  <Text style={styles.langTitle}>Mina</Text>
                  <Text style={styles.langDesc}>Mode vocal en mina</Text>
                </View>
              </Pressable>

              <Pressable style={styles.langCard} onPress={() => chooseLanguage("kabyè")}>
                <View style={styles.langIconBox}>
                  <Text style={styles.langEmoji}>🗣️</Text>
                </View>
                <View style={styles.langTextBox}>
                  <Text style={styles.langTitle}>Kabyè</Text>
                  <Text style={styles.langDesc}>Mode vocal en kabyè</Text>
                </View>
              </Pressable>

              <Pressable style={styles.langCard} onPress={() => chooseLanguage("fr")}>
                <View style={styles.langIconBox}>
                  <Text style={styles.langEmoji}>🇫🇷</Text>
                </View>
                <View style={styles.langTextBox}>
                  <Text style={styles.langTitle}>Français</Text>
                  <Text style={styles.langDesc}>Mode standard</Text>
                </View>
              </Pressable>

              <Pressable style={styles.langCard} onPress={() => chooseLanguage("mute")}>
                <View style={styles.langIconBox}>
                  <Text style={styles.langEmoji}>🔇</Text>
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
    >
      <View style={styles.overlay} />
      <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
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
              <Text style={styles.heroSmall}>Parle pour chercher</Text>

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
                    <Text style={styles.micIcon}>{isListening ? "⏹️" : "🎙️"}</Text>
                  </Animated.View>
                </Pressable>
              </View>

              <Text style={styles.heroStatus}>{statusLabel}</Text>
              <Text style={styles.heroHint}>
                {isListening
                  ? "Parle puis appuie encore pour envoyer."
                  : "Exemple : Moulédi pharmacie"}
              </Text>

              <Pressable onPress={onPressMic} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>{isListening ? "Arrêter" : "Parler"}</Text>
              </Pressable>
            </View>

            <View style={styles.quickCard}>
              <Text style={styles.sectionTitle}>Accès rapide</Text>

              <View style={styles.quickGrid}>
                <Pressable style={styles.quickItem} onPress={openPharmacies}>
                  <Text style={styles.quickIcon}>💊</Text>
                  <Text style={styles.quickText}>Pharmacie</Text>
                </Pressable>

                <Pressable style={styles.quickItem} onPress={openClinics}>
                  <Text style={styles.quickIcon}>🏥</Text>
                  <Text style={styles.quickText}>Clinique</Text>
                </Pressable>

                <Pressable style={styles.quickItem} onPress={openRestaurants}>
                  <Text style={styles.quickIcon}>🍽️</Text>
                  <Text style={styles.quickText}>Restaurant</Text>
                </Pressable>
              </View>
            </View>

            {statusText ? (
              <View style={styles.statusCard}>
                <Text style={styles.statusText}>{statusText}</Text>
              </View>
            ) : null}

            {showFallback ? (
              <View style={styles.choiceBox}>
                <Text style={styles.sectionTitle}>Tu peux choisir</Text>

                <View style={styles.choiceColumn}>
                  <Pressable onPress={openPharmacies} style={styles.choiceCard}>
                    <Text style={styles.choiceIcon}>💊</Text>
                    <Text style={styles.choiceText}>Pharmacies proches</Text>
                  </Pressable>

                  <Pressable onPress={openClinics} style={styles.choiceCard}>
                    <Text style={styles.choiceIcon}>🏥</Text>
                    <Text style={styles.choiceText}>Cliniques proches</Text>
                  </Pressable>

                  <Pressable onPress={openRestaurants} style={styles.choiceCard}>
                    <Text style={styles.choiceIcon}>🍽️</Text>
                    <Text style={styles.choiceText}>Restaurants proches</Text>
                  </Pressable>
                </View>

                <Pressable onPress={onPressMic} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryBtnText}>Réessayer au micro</Text>
                </Pressable>
              </View>
            ) : null}

            <Pressable onPress={() => setDebugMode((v) => !v)} style={styles.debugToggle}>
              <Text style={styles.debugToggleText}>
                {debugMode ? "Masquer debug" : "Mode debug"}
              </Text>
            </Pressable>

            {debugMode ? (
              <View style={styles.debugCard}>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="Ex: passeport"
                  placeholderTextColor={COLORS.textMuted}
                  style={styles.input}
                />
                <Pressable onPress={onDebugGo} style={styles.debugBtn}>
                  <Text style={styles.debugText}>Tester avec le texte</Text>
                </Pressable>
              </View>
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

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },

  safeArea: {
    flex: 1,
  },

  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: ANDROID_TOP,
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
    marginBottom: 16,
  },

  brandBlock: {
    flex: 1,
    paddingRight: 12,
  },

  brandTitle: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 2.2,
  },

  langPill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.darkPill,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
    justifyContent: "center",
  },

  langPillText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingVertical: 22,
    paddingHorizontal: 20,
    marginBottom: 16,
    alignItems: "center",
  },

  heroSmall: {
    color: COLORS.textSoft,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 12,
  },

  micZone: {
    width: "100%",
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },

  micHaloOuter: {
    position: "absolute",
    width: 228,
    height: 228,
    borderRadius: 999,
    backgroundColor: "rgba(181,98,46,0.10)",
    borderWidth: 1,
    borderColor: "rgba(181,98,46,0.12)",
  },

  micHaloInner: {
    position: "absolute",
    width: 188,
    height: 188,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderWidth: 1,
    borderColor: "rgba(181,98,46,0.10)",
  },

  micButtonWrap: {
    alignItems: "center",
    justifyContent: "center",
  },

  micButton: {
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.55)",
    zIndex: 2,
  },

  micButtonActive: {
    backgroundColor: COLORS.accentDark,
  },

  micIcon: {
    fontSize: 50,
  },

  heroStatus: {
    color: COLORS.text,
    fontSize: 21,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 8,
  },

  heroHint: {
    color: COLORS.textSoft,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 18,
  },

  primaryBtn: {
    minWidth: 180,
    backgroundColor: COLORS.accent,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  primaryBtnText: {
    color: "#FFF8F2",
    fontWeight: "900",
    fontSize: 16,
  },

  quickCard: {
    backgroundColor: COLORS.surfaceStrong,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 18,
    marginBottom: 16,
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

  quickItem: {
    flex: 1,
    minHeight: 96,
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 14,
  },

  quickIcon: {
    fontSize: 28,
    marginBottom: 8,
  },

  quickText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },

  statusCard: {
    backgroundColor: COLORS.statusBg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },

  statusText: {
    color: COLORS.text,
    textAlign: "center",
    fontWeight: "700",
  },

  choiceBox: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 18,
    marginBottom: 16,
  },

  choiceColumn: {
    gap: 10,
  },

  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },

  choiceIcon: {
    fontSize: 24,
    marginRight: 12,
  },

  choiceText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
  },

  secondaryBtn: {
    marginTop: 16,
    backgroundColor: COLORS.accentSoft,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.lineStrong,
  },

  secondaryBtnText: {
    color: COLORS.accentDark,
    fontWeight: "900",
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
    borderColor: COLORS.lineStrong,
    backgroundColor: "rgba(255,255,255,0.30)",
  },

  debugToggleText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },

  debugCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 14,
    marginBottom: 14,
  },

  input: {
    width: "100%",
    backgroundColor: COLORS.surfaceSoft,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.text,
    marginBottom: 12,
  },

  debugBtn: {
    width: "100%",
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.lineStrong,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },

  debugText: {
    color: COLORS.accentDark,
    fontWeight: "800",
  },

  langScreenTop: {
    marginTop: 6,
    marginBottom: 24,
  },

  langHeading: {
    color: COLORS.text,
    marginTop: 12,
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
    backgroundColor: COLORS.surface,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },

  langIconBox: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: COLORS.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  langEmoji: {
    fontSize: 22,
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
    borderColor: COLORS.lineStrong,
    backgroundColor: "rgba(255,255,255,0.35)",
  },

  ghostBtnText: {
    color: COLORS.textSoft,
    fontSize: 12,
    fontWeight: "700",
  },
});
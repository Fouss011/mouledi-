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
} from "react-native";
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
  if (isListening) return "Enregistrement en cours";
  if (!statusText) return "Prêt à écouter";
  return statusText;
}

const COLORS = {
  bg: "#050816",
  surface: "#0D1324",
  surface2: "#121A2D",
  surface3: "#0B1020",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.14)",
  text: "#F5F7FB",
  textSoft: "#AAB3C5",
  textMuted: "#7E879A",
  accent: "#53E5A7",
  accent2: "#63A4FF",
  accent3: "#8B7CFF",
  danger: "#FF7A7A",
  infoBg: "rgba(99,164,255,0.10)",
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
  const halo = useRef(new Animated.Value(0.45)).current;
  const glow = useRef(new Animated.Value(0.7)).current;

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
              duration: 900,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulse, {
              toValue: 1,
              duration: 900,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(halo, {
              toValue: 0.95,
              duration: 900,
              useNativeDriver: true,
            }),
            Animated.timing(halo, {
              toValue: 0.5,
              duration: 900,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(glow, {
              toValue: 1,
              duration: 900,
              useNativeDriver: true,
            }),
            Animated.timing(glow, {
              toValue: 0.7,
              duration: 900,
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
          toValue: 0.45,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.7,
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

  const statusLabel = getStatusLabel(statusText, isListening);

  if (showLangPicker) {
    return (
      <View style={styles.container}>
        <View style={styles.bgOrbTop} />
        <View style={styles.bgOrbBottom} />

        <View style={styles.headerBlock}>
          <Pressable onPress={handleTitlePress}>
            <Text style={styles.title}>MOULÉDI</Text>
          </Pressable>
          <Text style={styles.heroSubtitle}>Choisis ta langue</Text>
          <Text style={styles.heroDescription}>
            Une interface vocale simple, élégante et accessible pour agir rapidement.
          </Text>
        </View>

        <View style={styles.langGrid}>
          <Pressable style={styles.langCard} onPress={() => chooseLanguage("mina")}>
            <Text style={styles.langEmoji}>🗣️</Text>
            <View style={styles.langTextBox}>
              <Text style={styles.langTitle}>Mina</Text>
              <Text style={styles.langDesc}>Expérience vocale en mina</Text>
            </View>
          </Pressable>

          <Pressable style={styles.langCard} onPress={() => chooseLanguage("kabyè")}>
            <Text style={styles.langEmoji}>🗣️</Text>
            <View style={styles.langTextBox}>
              <Text style={styles.langTitle}>Kabyè</Text>
              <Text style={styles.langDesc}>Navigation et guides en kabyè</Text>
            </View>
          </Pressable>

          <Pressable style={styles.langCard} onPress={() => chooseLanguage("fr")}>
            <Text style={styles.langEmoji}>🇫🇷</Text>
            <View style={styles.langTextBox}>
              <Text style={styles.langTitle}>Français</Text>
              <Text style={styles.langDesc}>Mode standard en français</Text>
            </View>
          </Pressable>

          <Pressable style={styles.langCard} onPress={() => chooseLanguage("mute")}>
            <Text style={styles.langEmoji}>🔇</Text>
            <View style={styles.langTextBox}>
              <Text style={styles.langTitle}>Mode muet</Text>
              <Text style={styles.langDesc}>Sans lecture audio</Text>
            </View>
          </Pressable>
        </View>

        {showHiddenAccess ? (
          <View style={styles.bottomLinks}>
            <Pressable onPress={() => navigation.navigate("CollectProvider")} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Accès enquêteur</Text>
            </Pressable>

            <Pressable onPress={() => navigation.navigate("AdminReview")} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Admin validation</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />

      <View style={styles.stickyHeader}>
        <View style={styles.topBar}>
          <View style={styles.brandBlock}>
            <Pressable onPress={handleTitlePress}>
              <Text style={styles.title}>MOULÉDI</Text>
            </Pressable>
            <Text style={styles.subtitle}>Parler. Comprendre. Trouver.</Text>
          </View>

          <View style={styles.langPill}>
            <Text style={styles.langPillText}>
              {selectedLang === "mute"
                ? "MUET"
                : selectedLang === "fr"
                ? "FR"
                : selectedLang === "mina"
                ? "MINA"
                : "KABYÈ"}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        alwaysBounceVertical={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>VOICE AI</Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>Une recherche vocale qui agit vite</Text>
          <Text style={styles.heroDescription}>
            Appuie sur le micro, parle naturellement, puis laisse Moulédi comprendre et t’orienter.
          </Text>

          <View style={styles.voiceStateCard}>
            <Text style={styles.voiceStateLabel}>{statusLabel}</Text>
            <Text style={styles.voiceStateHint}>
              {isListening
                ? "Parle puis appuie de nouveau pour valider."
                : "Exemple : “Moulédji pharmacie”"}
            </Text>
          </View>

          <View style={styles.micWrap}>
            <Animated.View
              style={[
                styles.outerHalo,
                {
                  transform: [{ scale: pulse }],
                  opacity: halo,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.middleHalo,
                {
                  transform: [{ scale: pulse }],
                  opacity: glow,
                },
              ]}
            />

            <Pressable onPress={onPressMic} style={styles.micPressable}>
              <Animated.View
                style={[
                  styles.micButton,
                  isListening ? styles.micActive : null,
                  { transform: [{ scale: pulse }] },
                ]}
              >
                <Text style={styles.micText}>{isListening ? "⏹️" : "🎙️"}</Text>
              </Animated.View>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            {isListening
              ? "Enregistrement en cours… appuie sur STOP quand tu as fini."
              : "Appuie une fois pour parler, une deuxième fois pour envoyer."}
          </Text>
        </View>

        <View style={styles.quickCard}>
          <Text style={styles.sectionEyebrow}>Commandes rapides</Text>
          <Text style={styles.sectionTitle}>Tu peux dire par exemple</Text>

          <View style={styles.exampleList}>
            <Text style={styles.exampleItem}>• Moulédji pharmacie</Text>
            <Text style={styles.exampleItem}>• Moulédji clinique</Text>
            <Text style={styles.exampleItem}>• Moulédji restaurant</Text>
            <Text style={styles.exampleItem}>• Moulédji passeport</Text>
            <Text style={styles.exampleItem}>• Moulédji carte d’identité</Text>
          </View>
        </View>

        {statusText ? (
          <View style={styles.statusCard}>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        ) : null}

        {showFallback ? (
          <View style={styles.choiceBox}>
            <Text style={styles.sectionEyebrow}>Suggestion</Text>
            <Text style={styles.sectionTitle}>Je peux te proposer</Text>

            <View style={styles.choiceColumn}>
              <Pressable onPress={openPharmacies} style={styles.choiceCard}>
                <View style={styles.choiceIconWrap}>
                  <Text style={styles.choiceIcon}>💊</Text>
                </View>
                <View style={styles.choiceTextBox}>
                  <Text style={styles.choiceText}>Pharmacies</Text>
                  <Text style={styles.choiceSubtext}>Trouver les pharmacies proches</Text>
                </View>
              </Pressable>

              <Pressable onPress={openClinics} style={styles.choiceCard}>
                <View style={styles.choiceIconWrap}>
                  <Text style={styles.choiceIcon}>🏥</Text>
                </View>
                <View style={styles.choiceTextBox}>
                  <Text style={styles.choiceText}>Cliniques</Text>
                  <Text style={styles.choiceSubtext}>Chercher un centre de santé</Text>
                </View>
              </Pressable>

              <Pressable onPress={openRestaurants} style={styles.choiceCard}>
                <View style={styles.choiceIconWrap}>
                  <Text style={styles.choiceIcon}>🍽️</Text>
                </View>
                <View style={styles.choiceTextBox}>
                  <Text style={styles.choiceText}>Restaurants</Text>
                  <Text style={styles.choiceSubtext}>Voir les adresses autour de toi</Text>
                </View>
              </Pressable>
            </View>

            <Pressable onPress={onPressMic} style={styles.primaryRetryBtn}>
              <Text style={styles.primaryRetryBtnText}>Réessayer avec le micro</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={() => setDebugMode((v) => !v)} style={styles.debugToggle}>
          <Text style={styles.debugToggleText}>{debugMode ? "Masquer debug" : "Mode debug"}</Text>
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
            <Pressable onPress={() => navigation.navigate("CollectProvider")} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Accès enquêteur</Text>
            </Pressable>

            <Pressable onPress={() => navigation.navigate("AdminReview")} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Admin validation</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: 58,
    paddingHorizontal: 20,
    overflow: "hidden",
  },

  scrollView: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  scrollContent: {
    paddingBottom: 36,
    flexGrow: 1,
  },

  bgOrbTop: {
    position: "absolute",
    top: -80,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(99,164,255,0.08)",
  },

  bgOrbBottom: {
    position: "absolute",
    bottom: 60,
    left: -60,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(83,229,167,0.06)",
  },

  stickyHeader: {
    backgroundColor: COLORS.bg,
    paddingBottom: 14,
    zIndex: 20,
  },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },

  brandBlock: {
    flex: 1,
    paddingRight: 12,
  },

  headerBlock: {
    marginTop: 16,
    marginBottom: 28,
  },

  title: {
    color: COLORS.text,
    fontSize: 33,
    fontWeight: "900",
    letterSpacing: 4,
  },

  subtitle: {
    color: COLORS.textSoft,
    marginTop: 8,
    fontSize: 15,
  },

  heroSubtitle: {
    color: COLORS.textSoft,
    marginTop: 10,
    fontSize: 16,
  },

  heroTopRow: {
    width: "100%",
    alignItems: "flex-start",
    marginBottom: 10,
  },

  heroBadge: {
    backgroundColor: "rgba(99,164,255,0.14)",
    borderColor: "rgba(99,164,255,0.18)",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },

  heroBadgeText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },

  heroTitle: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 10,
  },

  heroDescription: {
    color: COLORS.textSoft,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },

  langPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(99,164,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(99,164,255,0.18)",
  },

  langPillText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
  },

  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 22,
    alignItems: "center",
    marginBottom: 16,
  },

  voiceStateCard: {
    width: "100%",
    marginTop: 18,
    marginBottom: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
  },

  voiceStateLabel: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
  },

  voiceStateHint: {
    color: COLORS.textSoft,
    fontSize: 13,
    marginTop: 4,
    textAlign: "center",
  },

  micWrap: {
    width: 290,
    height: 290,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 4,
  },

  outerHalo: {
    position: "absolute",
    width: 270,
    height: 270,
    borderRadius: 999,
    backgroundColor: "rgba(99,164,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(99,164,255,0.12)",
  },

  middleHalo: {
    position: "absolute",
    width: 225,
    height: 225,
    borderRadius: 999,
    backgroundColor: "rgba(83,229,167,0.10)",
    borderWidth: 1,
    borderColor: "rgba(83,229,167,0.12)",
  },

  micPressable: {
    alignItems: "center",
    justifyContent: "center",
  },

  micButton: {
    width: 182,
    height: 182,
    borderRadius: 999,
    backgroundColor: COLORS.surface3,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#63A4FF",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  micActive: {
    borderColor: "rgba(83,229,167,0.45)",
  },

  micText: {
    fontSize: 70,
  },

  hint: {
    color: COLORS.textSoft,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
    fontSize: 14,
    paddingHorizontal: 8,
  },

  quickCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 20,
    marginBottom: 14,
  },

  sectionEyebrow: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },

  sectionTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 14,
  },

  exampleList: {
    gap: 8,
  },

  exampleItem: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },

  statusCard: {
    backgroundColor: COLORS.infoBg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(99,164,255,0.14)",
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
    padding: 20,
    marginBottom: 14,
  },

  choiceColumn: {
    gap: 12,
    marginTop: 4,
  },

  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 14,
  },

  choiceIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  choiceIcon: {
    fontSize: 26,
  },

  choiceTextBox: {
    flex: 1,
  },

  choiceText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 2,
  },

  choiceSubtext: {
    color: COLORS.textSoft,
    fontSize: 13,
  },

  primaryRetryBtn: {
    marginTop: 16,
    backgroundColor: COLORS.accent,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },

  primaryRetryBtnText: {
    color: "#04120B",
    fontWeight: "900",
    fontSize: 15,
  },

  debugToggle: {
    alignSelf: "center",
    marginTop: 4,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.lineStrong,
    backgroundColor: "rgba(255,255,255,0.03)",
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
    marginBottom: 12,
  },

  input: {
    width: "100%",
    backgroundColor: COLORS.surface2,
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
    backgroundColor: "rgba(99,164,255,0.14)",
    borderColor: "rgba(99,164,255,0.18)",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },

  debugText: {
    color: COLORS.text,
    fontWeight: "800",
  },

  langGrid: {
    marginTop: 18,
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

  langEmoji: {
    fontSize: 24,
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
  },

  bottomLinks: {
    gap: 10,
    marginTop: 10,
    marginBottom: 16,
  },

  ghostBtn: {
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.lineStrong,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  ghostBtnText: {
    color: COLORS.textSoft,
    fontSize: 12,
    fontWeight: "700",
  },
});
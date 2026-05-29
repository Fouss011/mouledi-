import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Linking,
  Platform,
  Animated,
  ImageBackground,
  SafeAreaView,
  StatusBar,
} from "react-native";
import * as Speech from "expo-speech";
import { Audio } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Location from "expo-location";
import {
  Feather,
  Ionicons,
  MaterialCommunityIcons,
  FontAwesome5,
} from "@expo/vector-icons";

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
  white: "#FFFFFF",
  whiteSoft: "rgba(255,255,255,0.80)",
  danger: "#B14A36",
  dangerBg: "rgba(177,74,54,0.10)",
};

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

  const pulse = useRef(new Animated.Value(1)).current;

  const mode = useMemo(() => {
    if (intent === "PHARMACY_ON_CALL") return "oncall";
    if (intent === "CLINIC") return "clinic";
    if (intent === "RESTAURANT") return "restaurant";
    return "all";
  }, [intent]);

  const isListening = recording != null || webRec != null;
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

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;

    if (isListening) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.08,
            duration: 850,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 850,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
    } else {
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      if (loop) loop.stop();
    };
  }, [isListening, pulse]);

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
            setStatusText("Localisation indisponible sur ce navigateur.");
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
      setStatusText("Pharmacie de garde");
      await loadData(district, lat, lng, "oncall");
      return true;
    }
    if (resolvedIntent === "CLINIC") {
      setStatusText("Clinique");
      await loadData(district, lat, lng, "clinic");
      return true;
    }
    if (resolvedIntent === "RESTAURANT") {
      setStatusText("Restaurant");
      await loadData(district, lat, lng, "restaurant");
      return true;
    }
    if (resolvedIntent === "PASSPORT") {
      setStatusText("Passeport");
      navigation.navigate("Guide", { guideKey: "passport", lang: "fr" });
      return true;
    }
    if (resolvedIntent === "CNI") {
      setStatusText("Carte d’identité");
      navigation.navigate("Guide", { guideKey: "cni", lang: "fr" });
      return true;
    }
    if (resolvedIntent === "PHARMACY") {
      setStatusText("Pharmacie");
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
      setStatusText("Répète s’il te plaît");
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

    setStatusText("Connexion...");
    const okApi = await pingBackend();
    const okStt = await pingStt();

    if (!okApi) {
      setStatusText("Service indisponible");
      await playUi("repeat_please");
      return;
    }
    if (!okStt) {
      setStatusText("Voix indisponible");
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

    setStatusText("Compréhension...");
    let audioIntent: AudioIntent = "UNKNOWN";
    try {
      const resp = (await matchIntentFromAudio(uri)) as AudioIntentResp;
      audioIntent = pickClearAudioIntent(resp, { minConf: 0.62, minDelta: 0.08 }).intent;
    } catch {}

    if (audioIntent !== "UNKNOWN") {
      const handled = await handleResolvedIntent(audioIntent, lat, lng);
      if (handled) return;
    }

    setStatusText("Reconnaissance...");
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

              setStatusText("Connexion...");
              const okApi = await pingBackend();
              const okStt = await pingStt();

              if (!okApi) {
                setStatusText("Service indisponible");
                await playUi("repeat_please");
                return;
              }
              if (!okStt) {
                setStatusText("Voix indisponible");
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

              setStatusText("Compréhension...");
              let audioIntent: AudioIntent = "UNKNOWN";
              try {
                const resp = (await matchIntentFromBlob(blob)) as AudioIntentResp;
                audioIntent = pickClearAudioIntent(resp, { minConf: 0.62, minDelta: 0.08 }).intent;
              } catch {}

              if (audioIntent !== "UNKNOWN") {
                const handled = await handleResolvedIntent(audioIntent, lat, lng);
                if (handled) return;
              }

              setStatusText("Reconnaissance...");
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
      setStatusText("Localisation non disponible ou refusée");
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

  const pageSubtitle = hasCoords
    ? "Classés autour de toi"
    : district
    ? `Zone : ${district}`
    : "Recherche générale";

  const queryLabel = queryText?.trim()
    ? `Recherche vocale : ${queryText}`
    : `Recherche vocale : ${pageTitle.toLowerCase()}`;

  const getLocalityText = (item: ResultItem) => {
    const locality = [item.district || null, item.city || null].filter(Boolean).join(", ");
    if (locality) return locality;

    if (item.distance_km != null) {
      if (Number(item.distance_km) < 1) {
        return `À ${Math.round(Number(item.distance_km) * 1000)} m de toi`;
      }
      return `À ${item.distance_km} km de toi`;
    }

    return "Proche de toi";
  };

  const getDistanceText = (item: ResultItem) => {
    if (item.distance_km != null) return `${item.distance_km} km`;
    return hasCoords ? "Distance en cours" : "Sans distance";
  };

  const renderItem = ({ item, index }: { item: ResultItem; index: number }) => {
    const localityText = getLocalityText(item);
    const distanceText = getDistanceText(item);

    return (
      <Pressable onPress={() => speakNameOnly(item.name)} style={styles.card}>
        <View style={styles.cardTopRow}>
          <View style={styles.titleWrap}>
            <View style={styles.indexBadge}>
              <Text style={styles.indexBadgeText}>{index + 1}</Text>
            </View>

            <View style={styles.titleTextWrap}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardMeta}>{localityText}</Text>
            </View>
          </View>

          <Pressable
            onPress={async () => {
              await stopAllAudio();
              await openMaps(item);
            }}
            style={styles.mapBtn}
          >
            <Ionicons name="navigate-outline" size={19} color={COLORS.primaryDark} />
          </Pressable>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoPill}>
            <Ionicons name="location-outline" size={14} color={COLORS.primaryDark} />
            <Text style={styles.infoPillText}>{distanceText}</Text>
          </View>

          {item.type ? (
            <View style={styles.infoPillMuted}>
              <Text style={styles.infoPillMutedText}>{String(item.type).toUpperCase()}</Text>
            </View>
          ) : null}
        </View>

        {item.phone ? (
          <View style={styles.phoneRow}>
            <Feather name="phone" size={15} color={COLORS.textSoft} />
            <Text style={styles.cardSub}>{item.phone}</Text>
          </View>
        ) : (
          <View style={styles.phoneRow}>
            <Feather name="phone-off" size={15} color={COLORS.textMuted} />
            <Text style={styles.cardSubMuted}>Téléphone indisponible</Text>
          </View>
        )}

        <View style={styles.actionRow}>
          {item.phone ? (
            <Pressable
              onPress={async () => {
                await stopAllAudio();
                callPhone(item.phone);
              }}
              style={styles.callBtn}
            >
              <Feather name="phone-call" size={15} color={COLORS.white} />
              <Text style={styles.callText}>Appeler</Text>
            </Pressable>
          ) : (
            <View style={styles.callBtnDisabled}>
              <Text style={styles.callTextDisabled}>Indisponible</Text>
            </View>
          )}

          <Pressable
            onPress={async () => {
              await stopAllAudio();
              await openMaps(item);
            }}
            style={styles.routeBtn}
          >
            <Ionicons name="navigate" size={15} color={COLORS.text} />
            <Text style={styles.routeBtnText}>Itinéraire</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

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
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <Pressable
                onPress={async () => {
                  await stopAllAudio();
                  navigation.goBack();
                }}
                style={styles.backBtn}
              >
                <Feather name="arrow-left" size={20} color={COLORS.text} />
              </Pressable>

              <View style={styles.heroTextWrap}>
                <Text style={styles.heroEyebrow}>Résultats</Text>
                <Text style={styles.heroTitle}>{pageTitle}</Text>
                <Text style={styles.heroSubtitle}>{pageSubtitle}</Text>
              </View>

              <Animated.View style={{ transform: [{ scale: pulse }] }}>
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
                  style={[styles.heroMicBtn, isListening ? styles.heroMicBtnActive : null]}
                >
                  {isListening ? (
                    <Ionicons name="stop" size={20} color={COLORS.primaryDark} />
                  ) : (
                    <MaterialCommunityIcons
                      name="microphone"
                      size={22}
                      color={COLORS.primaryDark}
                    />
                  )}
                </Pressable>
              </Animated.View>
            </View>

            <View style={styles.queryPill}>
              <Feather name="search" size={16} color={COLORS.textMuted} />
              <Text style={styles.queryPillText}>{queryLabel}</Text>
            </View>
          </View>

          {statusText ? (
            <View style={styles.statusCard}>
              <View style={styles.statusDot} />
              <Text style={styles.status}>{statusText}</Text>
            </View>
          ) : null}

          {!hasCoords ? (
            <View style={styles.geoBox}>
              <View style={styles.geoTextWrap}>
                <Text style={styles.geoTitle}>Active la localisation</Text>
                <Text style={styles.geoText}>
                  Pour afficher la distance et mieux classer les résultats autour de toi.
                </Text>
              </View>

              <Pressable onPress={requestGeoAndReload} style={styles.geoBtn}>
                <Ionicons name="location-outline" size={16} color={COLORS.white} />
                <Text style={styles.geoBtnText}>Activer</Text>
              </Pressable>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.feedbackBox}>
              <Text style={styles.loading}>Chargement...</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          {!loading && !error ? (
            <FlatList
              data={items}
              keyExtractor={(it, idx) => `${it.provider_id ?? it.name}-${idx}`}
              contentContainerStyle={styles.listContent}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.feedbackBox}>
                  <Text style={styles.loading}>Aucun résultat.</Text>
                </View>
              }
            />
          ) : null}
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
  paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0,
},

  container: {
  flex: 1,
  paddingHorizontal: 16,
  paddingTop: 8,
},

  heroCard: {
  backgroundColor: COLORS.card,
  borderRadius: 28,
  borderWidth: 1,
  borderColor: COLORS.border,
  padding: 14,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },

  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  heroTextWrap: {
    flex: 1,
    paddingHorizontal: 12,
  },

  heroEyebrow: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 5,
  },

  heroTitle: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 30,
  },

  heroSubtitle: {
    color: COLORS.textSoft,
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
  },

  queryPill: {
    marginTop: 16,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 13,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },

  queryPillText: {
    color: COLORS.textSoft,
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
  },

  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.cardStrong,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  heroMicBtn: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: COLORS.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  heroMicBtnActive: {
    borderColor: COLORS.borderStrong,
    backgroundColor: "rgba(185,106,50,0.18)",
  },

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.whiteSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 12,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: COLORS.primary,
    marginRight: 10,
  },

  status: {
    flex: 1,
    color: COLORS.text,
    fontWeight: "700",
  },

  geoBox: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 14,
  },

  geoTextWrap: {
    marginBottom: 12,
  },

  geoTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
  },

  geoText: {
    color: COLORS.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },

  geoBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  geoBtnText: {
    color: COLORS.white,
    fontWeight: "800",
    fontSize: 14,
  },

  feedbackBox: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginTop: 4,
  },

  loading: {
    color: COLORS.textSoft,
    textAlign: "center",
  },

  errorBox: {
    backgroundColor: COLORS.dangerBg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(177,74,54,0.16)",
    padding: 16,
    marginTop: 4,
  },

  error: {
    color: COLORS.danger,
    textAlign: "center",
  },

  listContent: {
    paddingTop: 2,
    paddingBottom: 32,
  },

  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 26,
    padding: 18,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },

  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingRight: 10,
  },

  titleTextWrap: {
    flex: 1,
  },

  indexBadge: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    marginRight: 12,
  },

  indexBadgeText: {
    color: COLORS.primaryDark,
    fontSize: 14,
    fontWeight: "900",
  },

  cardTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 25,
    marginBottom: 5,
  },

  cardMeta: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 19,
  },

  mapBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: COLORS.cardStrong,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },

  infoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },

  infoPill: {
    backgroundColor: COLORS.primaryUltraSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
  },

  infoPillText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 6,
  },

  infoPillMuted: {
    backgroundColor: COLORS.cardSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  infoPillMutedText: {
    color: COLORS.textSoft,
    fontSize: 12,
    fontWeight: "700",
  },

  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 13,
  },

  cardSub: {
    color: COLORS.textSoft,
    marginLeft: 8,
    fontSize: 14,
  },

  cardSubMuted: {
    color: COLORS.textMuted,
    marginLeft: 8,
    fontSize: 14,
  },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },

  callBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  callText: {
    color: COLORS.white,
    fontWeight: "800",
    fontSize: 14,
  },

  callBtnDisabled: {
    flex: 1,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  callTextDisabled: {
    color: COLORS.textMuted,
    fontWeight: "700",
    fontSize: 13,
  },

  routeBtn: {
    flex: 1,
    backgroundColor: COLORS.cardStrong,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    gap: 8,
  },

  routeBtnText: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 14,
  },
});
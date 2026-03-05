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

/* ---------------- AUDIO UI ---------------- */

let currentSound: Audio.Sound | null = null;

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
  try {
    await stopAllAudio();

    const r = await fetch(`${BASE_URL}/health/ui-audio?key=${key}&lang=${lang}`);
    if (!r.ok) return;

    const data = await r.json();
    const url = data.url;

    const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
    currentSound = sound;

    sound.setOnPlaybackStatusUpdate((st: any) => {
      if (st?.didJustFinish) {
        sound.unloadAsync();
        currentSound = null;
      }
    });
  } catch {}
}

/* ---------------- GEO ---------------- */

async function getNearCoordsSafe(timeoutMs = 8000): Promise<{ nearLat: number | null; nearLng: number | null }> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ nearLat: pos.coords.latitude, nearLng: pos.coords.longitude }),
        () => resolve({ nearLat: null, nearLng: null }),
        { timeout: timeoutMs }
      );
    });
  }

  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { nearLat: null, nearLng: null };

    const loc = await Location.getCurrentPositionAsync({});
    return { nearLat: loc.coords.latitude, nearLng: loc.coords.longitude };
  } catch {
    return { nearLat: null, nearLng: null };
  }
}

/* ---------------- COMPONENT ---------------- */

export default function ResultsScreen({ navigation, route }: Props) {
  const { district, queryText, nearLat, nearLng, intent } = route.params as any;

  const [items, setItems] = useState<PharmacyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("");

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [webRec, setWebRec] = useState<MediaRecorder | null>(null);
  const [webStream, setWebStream] = useState<any>(null);

  /* ----------- NOUVEAU : écran écoute ----------- */

  const [listenOpen, setListenOpen] = useState(false);
  const [listenHint, setListenHint] = useState("J'écoute...");

  const isListening = Platform.OS === "web" ? !!webRec : !!recording;

  const mode = useMemo(() => {
    if (intent === "PHARMACY_ON_CALL") return "oncall";
    if (intent === "CLINIC") return "clinic";
    return "all";
  }, [intent]);

  /* ---------------- DATA ---------------- */

  const loadData = async (district: string | null, lat?: number | null, lng?: number | null, mode?: string) => {
    setLoading(true);

    let res: PharmacyItem[] = [];

    if (mode === "oncall") {
      res = await searchPharmaciesOnCall(district, lat ?? undefined, lng ?? undefined);
    } else if (mode === "clinic") {
      res = await searchClinics(district, lat ?? undefined, lng ?? undefined);
    } else {
      res = await searchPharmacies(district, lat ?? undefined, lng ?? undefined);
    }

    setItems(res);
    setLoading(false);
  };

  useEffect(() => {
    loadData(district, nearLat, nearLng, mode);
  }, []);

  /* ---------------- UNKNOWN ---------------- */

  const handleUnknownQuery = async () => {
    await playUi("fallback_pharmacies_or_retry");
    setListenHint("Je n’ai pas compris. Dis pharmacie ou clinique.");
    setListenOpen(true);
  };

  /* ---------------- MOBILE RECORD ---------------- */

  const startRecording = async () => {
    setListenHint("J'écoute... Appuie sur STOP quand tu as fini.");
    setListenOpen(true);

    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) return;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const rec = new Audio.Recording();

    await rec.prepareToRecordAsync({
      android: {
        extension: ".m4a",
        outputFormat: Audio.AndroidOutputFormat.MPEG_4,
        audioEncoder: Audio.AndroidAudioEncoder.AAC,
      },
      ios: {
        extension: ".m4a",
        audioQuality: Audio.IOSAudioQuality.LOW,
      },
    } as any);

    await rec.startAsync();
    setRecording(rec);
  };

  const stopRecordingAndSearch = async (rec: Audio.Recording) => {
    await rec.stopAndUnloadAsync();
    const uri = rec.getURI();
    setRecording(null);

    const okApi = await pingBackend();
    const okStt = await pingStt();

    if (!okApi || !okStt) return;

    let audioIntent = "UNKNOWN";

    try {
      const resp = await matchIntentFromAudio(uri!);
      audioIntent = resp.intent;
    } catch {}

    if (audioIntent === "PHARMACY") {
      setListenOpen(false);
      await loadData(district, nearLat, nearLng, "all");
      return;
    }

    if (audioIntent === "CLINIC") {
      setListenOpen(false);
      await loadData(district, nearLat, nearLng, "clinic");
      return;
    }

    const { text } = await sttFromAudio(uri!);

    if (text && !text.toLowerCase().includes("moul")) {
      await playUi("say_mouledi_command");
      setListenHint("Dis : Moulédji pharmacie ou Moulédji clinique.");
      setListenOpen(true);
      return;
    }

    if (!text) {
      await handleUnknownQuery();
      return;
    }

    const { intent: newIntent } = routeQuery(text);

    if (newIntent === "PHARMACY") {
      setListenOpen(false);
      await loadData(district, nearLat, nearLng, "all");
      return;
    }

    if (newIntent === "CLINIC") {
      setListenOpen(false);
      await loadData(district, nearLat, nearLng, "clinic");
      return;
    }

    await handleUnknownQuery();
  };

  /* ---------------- MICRO ---------------- */

  const onPressMic = async () => {
    await stopAllAudio();

    if (Platform.OS === "web") {
      if (!webRec) {
        setListenHint("J'écoute... Appuie sur STOP quand tu as fini.");
        setListenOpen(true);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setWebStream(stream);

        const rec = new MediaRecorder(stream);
        const chunks: BlobPart[] = [];

        rec.ondataavailable = (e) => chunks.push(e.data);

        rec.onstop = async () => {
          const blob = new Blob(chunks, { type: "audio/webm" });

          let intent = "UNKNOWN";

          try {
            const r = await matchIntentFromBlob(blob);
            intent = r.intent;
          } catch {}

          if (intent === "PHARMACY") {
            setListenOpen(false);
            await loadData(district, nearLat, nearLng, "all");
            return;
          }

          if (intent === "CLINIC") {
            setListenOpen(false);
            await loadData(district, nearLat, nearLng, "clinic");
            return;
          }

          await handleUnknownQuery();
        };

        rec.start();
        setWebRec(rec);
      } else {
        webRec.stop();
        webStream?.getTracks().forEach((t: any) => t.stop());
        setWebRec(null);
      }

      return;
    }

    if (recording) {
      await stopRecordingAndSearch(recording);
    } else {
      await startRecording();
    }
  };

  /* ---------------- UI ---------------- */

  return (
    <View style={styles.container}>
      {/* HEADER */}

      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </Pressable>

        <Text style={styles.title}>
          {intent === "CLINIC" ? "Cliniques" : "Pharmacies"}
        </Text>

        <Pressable onPress={onPressMic}>
          <Text style={styles.mic}>🎙️</Text>
        </Pressable>
      </View>

      {loading ? (
        <Text style={styles.loading}>Chargement...</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it, i) => i.toString()}
          renderItem={({ item }) => (
            <Pressable style={styles.card}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.city}>{item.city}</Text>
            </Pressable>
          )}
        />
      )}

      {/* ----------- OVERLAY ÉCOUTE ----------- */}

      {listenOpen && (
        <View style={styles.listenOverlay}>
          <Text style={styles.listenTitle}>{listenHint}</Text>

          <Pressable style={styles.stopBtn} onPress={onPressMic}>
            <Text style={styles.stopText}>⏹️ STOP</Text>
          </Pressable>

          <Text style={styles.listenSub}>
            Dis : moulédji pharmacie ou moulédji clinique
          </Text>
        </View>
      )}
    </View>
  );
}

/* ---------------- STYLE ---------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    alignItems: "center",
  },

  back: { color: "#fff", fontSize: 22 },

  title: { color: "#fff", fontSize: 18, fontWeight: "bold" },

  mic: { color: "#fff", fontSize: 22 },

  loading: { color: "#fff", textAlign: "center", marginTop: 30 },

  card: {
    backgroundColor: "#111",
    padding: 16,
    margin: 10,
    borderRadius: 10,
  },

  name: { color: "#fff", fontSize: 16 },

  city: { color: "#888" },

  /* ---------- LISTEN OVERLAY ---------- */

  listenOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },

  listenTitle: {
    color: "#fff",
    fontSize: 18,
    marginBottom: 30,
  },

  stopBtn: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "#111",
    borderWidth: 2,
    borderColor: "#444",
    alignItems: "center",
    justifyContent: "center",
  },

  stopText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
  },

  listenSub: {
    color: "#888",
    marginTop: 30,
  },
});
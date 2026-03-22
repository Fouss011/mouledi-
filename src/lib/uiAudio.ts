import { Audio } from "expo-av";
import { BASE_URL } from "./api";

let currentSound: Audio.Sound | null = null;

async function stopCurrent() {
  try {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      currentSound = null;
    }
  } catch {}
}

function getFileExtension(url: string) {
  try {
    const clean = url.split("?")[0].toLowerCase();
    const parts = clean.split(".");
    return parts.length > 1 ? parts.pop() || "" : "";
  } catch {
    return "";
  }
}

export async function playUi(key: string, lang: string = "mina") {
  await stopCurrent();

  try {
    const r = await fetch(
      `${BASE_URL}/health/ui-audio?key=${encodeURIComponent(key)}&lang=${encodeURIComponent(lang)}`
    );

    if (!r.ok) {
      console.warn("UI audio not found:", key, lang);
      return;
    }

    const data = await r.json();
    const url = data.url as string;

    if (!url) {
      console.warn("UI audio URL missing:", key, lang);
      return;
    }

    const ext = getFileExtension(url);
    console.log("[playUi] key =", key, "| lang =", lang, "| ext =", ext, "| url =", url);

    if (ext === "webm") {
      console.warn(
        `[playUi] Audio UI refusé car format webm non fiable sur mobile: key=${key}, lang=${lang}, url=${url}`
      );
      return;
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: true }
    );

    currentSound = sound;

    sound.setOnPlaybackStatusUpdate((st: any) => {
      if (st?.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        if (currentSound === sound) currentSound = null;
      }
    });
  } catch (err) {
    console.warn("playUi error:", err);
  }
}
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

export async function playUi(key: string, lang: string = "mina") {
  await stopCurrent();

  const r = await fetch(
    `${BASE_URL}/health/ui-audio?key=${encodeURIComponent(key)}&lang=${encodeURIComponent(lang)}`
  );

  if (!r.ok) {
    console.warn("UI audio not found:", key);
    return;
  }

  const data = await r.json();
  const url = data.url as string;

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
}
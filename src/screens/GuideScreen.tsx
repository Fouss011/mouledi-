import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ImageBackground,
  SafeAreaView,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { ADMIN_GUIDES, GuideLanguage } from "../data/adminGuides";

type Props = NativeStackScreenProps<RootStackParamList, "Guide">;

type GuideKey = "passport" | "cni" | "casier";

const COLORS = {
  bg: "#F5EFE4",
  overlay: "rgba(245,239,228,0.88)",
  surface: "rgba(255,251,245,0.94)",
  surfaceSoft: "rgba(255,248,239,0.90)",
  border: "rgba(110,78,42,0.12)",
  borderStrong: "rgba(110,78,42,0.20)",
  text: "#2E2418",
  textSoft: "#5E4B38",
  textMuted: "#8A7561",
  accent: "#A85C2C",
  accentSoft: "#E8D2BF",
  badgeBg: "#F1E0CF",
  noteBg: "#F6E8D8",
  shadow: "rgba(63, 37, 14, 0.08)",
};

export default function GuideScreen({ navigation, route }: Props) {
  const rawGuideKey = route.params?.guideKey;
  const rawLang = route.params?.lang;

  const lang: GuideLanguage =
    rawLang === "fr" || rawLang === "mina" || rawLang === "kabyè" ? rawLang : "fr";

  const guideKey: GuideKey =
    rawGuideKey === "passport" || rawGuideKey === "cni" || rawGuideKey === "casier"
      ? rawGuideKey
      : "passport";

  const guide =
    ADMIN_GUIDES?.[lang]?.[guideKey] ??
    ADMIN_GUIDES?.fr?.[guideKey] ??
    ADMIN_GUIDES.fr.passport;

  return (
    <ImageBackground
      source={require("../assets/mouledi-bg.png")}
      style={styles.background}
      resizeMode="cover"
    >
      <View style={styles.overlay} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
                <Text style={styles.backText}>←</Text>
              </Pressable>

              <View style={styles.headerTextBlock}>
                <Text style={styles.kicker}>Guide</Text>
                <Text style={styles.title}>{guide.title}</Text>
                <Text style={styles.subtitle}>
                  Lis les étapes une par une, simplement.
                </Text>
              </View>
            </View>

            <View style={styles.langPill}>
              <Text style={styles.langPillText}>
                {lang === "fr" ? "Français" : lang === "mina" ? "Mina" : "Kabyè"}
              </Text>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.mainCard}>
              {guide.steps.map((step, idx) => (
                <View key={`${guideKey}-${idx}`} style={styles.stepRow}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{idx + 1}</Text>
                  </View>

                  <View style={styles.stepCard}>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={styles.stepText}>{step.body}</Text>
                  </View>
                </View>
              ))}

              {guide.note ? (
                <View style={styles.noteBox}>
                  <Text style={styles.noteTitle}>À retenir</Text>
                  <Text style={styles.noteText}>{guide.note}</Text>
                </View>
              ) : null}
            </View>
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
    paddingTop: 10,
  },

  headerCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  backText: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "800",
  },

  headerTextBlock: {
    flex: 1,
  },

  kicker: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  title: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 30,
    marginBottom: 6,
  },

  subtitle: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 20,
  },

  langPill: {
    marginTop: 14,
    alignSelf: "flex-start",
    backgroundColor: COLORS.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  langPillText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: "800",
  },

  content: {
    paddingBottom: 30,
  },

  mainCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },

  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },

  badge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.badgeBg,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    marginTop: 2,
  },

  badgeText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: "900",
  },

  stepCard: {
    flex: 1,
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 15,
  },

  stepTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 6,
  },

  stepText: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 22,
  },

  noteBox: {
    marginTop: 6,
    backgroundColor: COLORS.noteBg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 15,
  },

  noteTitle: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  noteText: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 22,
  },
});
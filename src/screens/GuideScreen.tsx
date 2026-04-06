import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { ADMIN_GUIDES, GuideLanguage } from "../data/adminGuides";

type Props = NativeStackScreenProps<RootStackParamList, "Guide">;

type GuideKey = "passport" | "cni" | "casier";

const COLORS = {
  bg: "#020B1F",
  surface: "#07162D",
  surface2: "#0B1D36",
  surface3: "#102542",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.14)",
  text: "#FFFFFF",
  textSoft: "rgba(255,255,255,0.72)",
  textMuted: "rgba(255,255,255,0.48)",
  accent: "#14F1D9",
  accent2: "#0EA5E9",
  accent3: "#8B7CFF",
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
    <View style={styles.container}>
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />

      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </Pressable>

          <View style={styles.heroTextBox}>
            <Text style={styles.eyebrow}>Guide pratique</Text>
            <Text style={styles.title}>{guide.title}</Text>
            <Text style={styles.subtitle}>
              Suis les étapes ci-dessous pour comprendre rapidement la procédure.
            </Text>
          </View>
        </View>

        <View style={styles.langPill}>
          <Text style={styles.langPillText}>
            {lang === "fr" ? "FRANÇAIS" : lang === "mina" ? "MINA" : "KABYÈ"}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.intro}>
            Ce guide te présente les étapes essentielles de manière simple, claire et lisible.
          </Text>

          <View style={styles.divider} />

          {guide.steps.map((step, idx) => (
            <View key={`${guideKey}-${idx}`} style={styles.stepRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{idx + 1}</Text>
              </View>

              <View style={styles.stepContent}>
                <Text style={styles.stepLabel}>{step.title}</Text>
                <Text style={styles.stepText}>{step.body}</Text>
              </View>
            </View>
          ))}

          {guide.note ? (
            <View style={styles.noteBox}>
              <Text style={styles.noteTitle}>Note importante</Text>
              <Text style={styles.note}>{guide.note}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: 58,
    paddingHorizontal: 18,
    overflow: "hidden",
  },

  bgOrbTop: {
    position: "absolute",
    top: -100,
    right: -60,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "rgba(14,165,233,0.08)",
  },

  bgOrbBottom: {
    position: "absolute",
    bottom: -40,
    left: -80,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(20,241,217,0.06)",
  },

  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 18,
    marginBottom: 18,
  },

  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },

  heroTextBox: {
    flex: 1,
  },

  backBtn: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: "center",
    justifyContent: "center",
  },

  backText: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "800",
  },

  eyebrow: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },

  title: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 31,
    marginBottom: 6,
  },

  subtitle: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 21,
  },

  langPill: {
    marginTop: 18,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  langPillText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },

  content: {
    paddingBottom: 40,
  },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 20,
  },

  intro: {
    color: COLORS.textSoft,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 18,
  },

  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: 22,
  },

  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  },

  badge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(20,241,217,0.12)",
    borderWidth: 1,
    borderColor: "rgba(20,241,217,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },

  badgeText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: "900",
  },

  stepContent: {
    flex: 1,
    backgroundColor: COLORS.surface2,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 16,
  },

  stepLabel: {
    color: COLORS.accent2,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },

  stepText: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 23,
  },

  noteBox: {
    marginTop: 8,
    backgroundColor: "rgba(20,241,217,0.08)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(20,241,217,0.14)",
    padding: 16,
  },

  noteTitle: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  note: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 22,
  },
});
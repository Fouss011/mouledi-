import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { ADMIN_GUIDES } from "../data/adminGuides";

type Props = NativeStackScreenProps<RootStackParamList, "Guide">;

export default function GuideScreen({ navigation, route }: Props) {
  const { guideKey, lang = "fr" } = route.params;
  const guide = ADMIN_GUIDES[guideKey]?.[lang] || ADMIN_GUIDES[guideKey]?.fr;

  return (
    <View style={styles.container}>
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />

      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>

        <View style={styles.headerTextBox}>
          <Text style={styles.eyebrow}>Guide pratique</Text>
          <Text style={styles.title}>{guide.title}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.intro}>{guide.intro}</Text>

          <View style={styles.divider} />

          {guide.steps.map((step, idx) => (
            <View key={`${guideKey}-${idx}`} style={styles.stepRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{idx + 1}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepLabel}>Étape {idx + 1}</Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            </View>
          ))}

          {guide.note ? (
            <View style={styles.noteBox}>
              <Text style={styles.noteTitle}>Note</Text>
              <Text style={styles.note}>{guide.note}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const COLORS = {
  bg: "#050816",
  surface: "#0D1324",
  surface2: "#121A2D",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.14)",
  text: "#F5F7FB",
  textSoft: "#AAB3C5",
  textMuted: "#7E879A",
  accent: "#53E5A7",
  accent2: "#63A4FF",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: 54,
    paddingHorizontal: 16,
    overflow: "hidden",
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
    bottom: 40,
    left: -60,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(83,229,167,0.06)",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },

  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.line,
  },

  backText: {
    color: COLORS.text,
    fontSize: 21,
    fontWeight: "700",
  },

  headerTextBox: {
    flex: 1,
  },

  eyebrow: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },

  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "900",
    flexShrink: 1,
  },

  content: {
    paddingBottom: 32,
  },

  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
  },

  intro: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 24,
  },

  divider: {
    height: 1,
    backgroundColor: COLORS.line,
    marginVertical: 16,
  },

  stepRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
    alignItems: "flex-start",
  },

  badge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(99,164,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(99,164,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },

  badgeText: {
    color: COLORS.text,
    fontWeight: "900",
    fontSize: 13,
  },

  stepContent: {
    flex: 1,
    backgroundColor: COLORS.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 14,
  },

  stepLabel: {
    color: COLORS.accent2,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
    textTransform: "uppercase",
  },

  stepText: {
    color: COLORS.textSoft,
    lineHeight: 22,
    fontSize: 14,
  },

  noteBox: {
    marginTop: 8,
    backgroundColor: "rgba(83,229,167,0.08)",
    borderWidth: 1,
    borderColor: "rgba(83,229,167,0.14)",
    borderRadius: 18,
    padding: 14,
  },

  noteTitle: {
    color: COLORS.accent,
    fontWeight: "800",
    marginBottom: 6,
  },

  note: {
    color: COLORS.textSoft,
    lineHeight: 21,
  },
});
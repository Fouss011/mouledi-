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
import { Feather, Ionicons } from "@expo/vector-icons";
import { RootStackParamList } from "../../App";
import { ADMIN_GUIDES, GuideLanguage } from "../data/adminGuides";

type Props = NativeStackScreenProps<RootStackParamList, "Guide">;

type GuideKey =
  | "passport"
  | "cni"
  | "casier"
  | "birth_certificate"
  | "nationality_certificate";

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
  noteBg: "rgba(185,106,50,0.08)",
  white: "#FFFFFF",
};

export default function GuideScreen({ navigation, route }: Props) {
  const rawGuideKey = route.params?.guideKey;
  const rawLang = route.params?.lang;

  const lang: GuideLanguage =
    rawLang === "fr" || rawLang === "mina" || rawLang === "kabyè" ? rawLang : "fr";

  const guideKey: GuideKey =
    rawGuideKey === "passport" ||
    rawGuideKey === "cni" ||
    rawGuideKey === "casier" ||
    rawGuideKey === "birth_certificate" ||
    rawGuideKey === "nationality_certificate"
      ? rawGuideKey
      : "passport";

  const guide =
    ADMIN_GUIDES?.[lang]?.[guideKey] ??
    ADMIN_GUIDES?.fr?.[guideKey] ??
    ADMIN_GUIDES?.fr?.passport;

  const langLabel =
    lang === "fr" ? "Français" : lang === "mina" ? "Mina" : "Kabyè";

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
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
                <Feather name="arrow-left" size={20} color={COLORS.text} />
              </Pressable>

              <View style={styles.headerTextBlock}>
                <Text style={styles.kicker}>Guide pratique</Text>
                <Text style={styles.title}>{guide.title}</Text>
                <Text style={styles.subtitle}>
                  Suis les étapes une par une, simplement.
                </Text>
              </View>
            </View>

            <View style={styles.headerBottom}>
              <View style={styles.langPill}>
                <Ionicons name="language-outline" size={14} color={COLORS.primaryDark} />
                <Text style={styles.langPillText}>{langLabel}</Text>
              </View>
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
                  <View style={styles.noteHeader}>
                    <View style={styles.noteIconWrap}>
                      <Feather name="info" size={15} color={COLORS.primaryDark} />
                    </View>
                    <Text style={styles.noteTitle}>À retenir</Text>
                  </View>

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

  headerCard: {
    backgroundColor: COLORS.card,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },

  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.cardStrong,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  headerTextBlock: {
    flex: 1,
  },

  kicker: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 1,
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

  headerBottom: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
  },

  langPill: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
  },

  langPillText: {
    color: COLORS.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 6,
  },

  content: {
    paddingBottom: 30,
  },

  mainCard: {
    backgroundColor: COLORS.card,
    borderRadius: 30,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    marginTop: 2,
  },

  badgeText: {
    color: COLORS.primaryDark,
    fontSize: 14,
    fontWeight: "900",
  },

  stepCard: {
    flex: 1,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },

  stepTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 7,
  },

  stepText: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 22,
  },

  noteBox: {
    marginTop: 6,
    backgroundColor: COLORS.noteBg,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },

  noteHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },

  noteIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },

  noteTitle: {
    color: COLORS.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  noteText: {
    color: COLORS.textSoft,
    fontSize: 14,
    lineHeight: 22,
  },
});
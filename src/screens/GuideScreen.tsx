import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { RootStackParamList } from "../../App";
import { ADMIN_GUIDES } from "../data/adminGuides";

type Props = NativeStackScreenProps<RootStackParamList, "Guide">;

export default function GuideScreen({ navigation, route }: Props) {
  const { guideKey, lang = "fr" } = route.params;
  const safeLang = lang in ADMIN_GUIDES ? lang : "fr";
  const guide = ADMIN_GUIDES[safeLang][guideKey];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{guide.title}</Text>
          <Text style={styles.subtitle}>Guide administratif simplifié</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {guide.steps.map((step, idx) => (
          <View key={`${guide.key}-${idx}`} style={styles.card}>
            <Text style={styles.stepTitle}>
              {step.title && step.title !== `${idx + 1}` ? step.title : `Étape ${idx + 1}`}
            </Text>
            <Text style={styles.stepBody}>{step.body}</Text>
          </View>
        ))}

        {guide.note ? <Text style={styles.note}>{guide.note}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", paddingTop: 54, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#222",
  },
  backText: { color: "#fff", fontSize: 20 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "#aaa", marginTop: 2 },
  content: { paddingVertical: 12, paddingBottom: 40 },
  card: {
    backgroundColor: "#0b0b0b",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  stepTitle: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 6 },
  stepBody: { color: "#ccc", lineHeight: 22 },
  note: { color: "#888", marginTop: 6, fontSize: 13, lineHeight: 20 },
});
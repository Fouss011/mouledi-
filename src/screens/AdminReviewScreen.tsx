import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  Alert,
  Image,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../lib/supabase";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "AdminReview">;

type PendingItem = {
  id: string;
  country: string;
  type: string;
  category: string;
  name: string;
  phone: string | null;
  city: string;
  district: string;
  address: string | null;
  lat: number;
  lng: number;
  description_short: string | null;
  notes: string | null;
  collector_name: string | null;
  proof_image_url: string | null;
  possible_duplicate: boolean;
  duplicate_note: string | null;
  status: string;
  created_at: string;
};

export default function AdminReviewScreen({ navigation }: Props) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("providers_pending")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setItems((data || []) as PendingItem[]);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Impossible de charger les fiches.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const validateItem = async (item: PendingItem) => {
    try {
      setBusyId(item.id);

      const providerPayload = {
        provider_id: item.id,
        country: item.country,
        type: item.type,
        category: item.category,
        name: item.name,
        phone: item.phone,
        city: item.city,
        district: item.district,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        description_short: item.description_short,
        notes: item.notes,
        proof_image_url: item.proof_image_url,
        source_pending_id: item.id,
        validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: insertError } = await supabase
        .from("providers")
        .insert(providerPayload);

      if (insertError) throw insertError;

      const { error: updateError } = await supabase
        .from("providers_pending")
        .update({ status: "validated" })
        .eq("id", item.id);

      if (updateError) throw updateError;

      Alert.alert("Succès", "Fiche validée et copiée dans providers.");
      await loadItems();
    } catch (e: any) {
      Alert.alert("Erreur validation", e?.message || "Validation impossible.");
    } finally {
      setBusyId(null);
    }
  };

  const rejectItem = async (item: PendingItem) => {
    try {
      setBusyId(item.id);

      const { error } = await supabase
        .from("providers_pending")
        .update({ status: "rejected" })
        .eq("id", item.id);

      if (error) throw error;

      Alert.alert("Rejetée", "La fiche a été rejetée.");
      await loadItems();
    } catch (e: any) {
      Alert.alert("Erreur rejet", e?.message || "Rejet impossible.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmValidate = (item: PendingItem) => {
    Alert.alert(
      "Valider cette fiche ?",
      `${item.name}\n${item.city} - ${item.district}`,
      [
        { text: "Annuler", style: "cancel" },
        { text: "Valider", onPress: () => validateItem(item) },
      ]
    );
  };

  const confirmReject = (item: PendingItem) => {
    Alert.alert(
      "Rejeter cette fiche ?",
      `${item.name}\n${item.city} - ${item.district}`,
      [
        { text: "Annuler", style: "cancel" },
        { text: "Rejeter", style: "destructive", onPress: () => rejectItem(item) },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>← Retour</Text>
        </Pressable>

        <Pressable style={styles.reloadBtn} onPress={loadItems}>
          <Text style={styles.reloadBtnText}>Rafraîchir</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Admin validation</Text>
      <Text style={styles.subtitle}>Fiches en attente dans providers_pending</Text>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 30 }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>Aucune fiche pending.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const busy = busyId === item.id;

            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.type} • {item.city}, {item.district}
                </Text>

                {item.phone ? <Text style={styles.meta}>📞 {item.phone}</Text> : null}
                {item.address ? <Text style={styles.meta}>📍 {item.address}</Text> : null}
                <Text style={styles.meta}>
                  GPS: {item.lat}, {item.lng}
                </Text>

                {item.collector_name ? (
                  <Text style={styles.meta}>Enquêteur: {item.collector_name}</Text>
                ) : null}

                {item.description_short ? (
                  <Text style={styles.meta}>Description: {item.description_short}</Text>
                ) : null}

                {item.notes ? <Text style={styles.meta}>Notes: {item.notes}</Text> : null}

                {item.possible_duplicate ? (
                  <View style={styles.warningBox}>
                    <Text style={styles.warningTitle}>Doublon potentiel</Text>
                    <Text style={styles.warningText}>
                      {item.duplicate_note || "Alerte doublon."}
                    </Text>
                  </View>
                ) : null}

                {item.proof_image_url ? (
                  <Image source={{ uri: item.proof_image_url }} style={styles.previewImage} />
                ) : (
                  <View style={styles.noImageBox}>
                    <Text style={styles.noImageText}>Pas de photo preuve</Text>
                  </View>
                )}

                <View style={styles.actionsRow}>
                  <Pressable
                    style={[styles.actionBtn, styles.validateBtn, busy && styles.disabledBtn]}
                    onPress={() => confirmValidate(item)}
                    disabled={busy}
                  >
                    {busy ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <Text style={styles.validateText}>Valider</Text>
                    )}
                  </Pressable>

                  <Pressable
                    style={[styles.actionBtn, styles.rejectBtn, busy && styles.disabledBtn]}
                    onPress={() => confirmReject(item)}
                    disabled={busy}
                  >
                    <Text style={styles.rejectText}>Rejeter</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  backBtn: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  reloadBtn: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reloadBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 6,
  },
  subtitle: {
    color: "#888",
    marginBottom: 16,
  },
  centered: {
    marginTop: 40,
    alignItems: "center",
  },
  loadingText: {
    color: "#aaa",
    marginTop: 10,
  },
  emptyBox: {
    marginTop: 40,
    alignItems: "center",
  },
  emptyText: {
    color: "#777",
  },
  card: {
    backgroundColor: "#0b0b0b",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  meta: {
    color: "#bbb",
    marginBottom: 4,
  },
  warningBox: {
    backgroundColor: "#1a1200",
    borderColor: "#5b4300",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    marginBottom: 10,
  },
  warningTitle: {
    color: "#ffcc66",
    fontWeight: "800",
    marginBottom: 4,
  },
  warningText: {
    color: "#f5deb3",
  },
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: 12,
    marginTop: 10,
    marginBottom: 12,
  },
  noImageBox: {
    height: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    marginBottom: 12,
  },
  noImageText: {
    color: "#666",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  validateBtn: {
    backgroundColor: "#fff",
  },
  validateText: {
    color: "#000",
    fontWeight: "800",
  },
  rejectBtn: {
    backgroundColor: "#111",
    borderColor: "#333",
    borderWidth: 1,
  },
  rejectText: {
    color: "#fff",
    fontWeight: "800",
  },
  disabledBtn: {
    opacity: 0.5,
  },
});
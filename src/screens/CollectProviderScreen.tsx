import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import * as Location from "expo-location";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../lib/supabase";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "CollectProvider">;

type CountryCode = "TG" | "BJ" | "SN";

type ProviderType =
  | "pharmacy"
  | "clinic"
  | "restaurant"
  | "hotel"
  | "administrative"
  | "other";

type ProviderCategory =
  | "health"
  | "administrative"
  | "food"
  | "lodging"
  | "commerce"
  | "service";

type FormState = {
  country: CountryCode;
  type: ProviderType;
  category: ProviderCategory;
  name: string;
  phone: string;
  city: string;
  district: string;
  address: string;
  descriptionShort: string;
  notes: string;
  collectorName: string;
  lat: string;
  lng: string;
};

const initialForm: FormState = {
  country: "TG",
  type: "pharmacy",
  category: "health",
  name: "",
  phone: "",
  city: "",
  district: "",
  address: "",
  descriptionShort: "",
  notes: "",
  collectorName: "",
  lat: "",
  lng: "",
};

function ChoiceChip<T extends string>({
  label,
  value,
  selectedValue,
  onPress,
}: {
  label: string;
  value: T;
  selectedValue: T;
  onPress: (value: T) => void;
}) {
  const selected = value === selectedValue;

  return (
    <Pressable
      onPress={() => onPress(value)}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function CollectProviderScreen({ navigation }: Props) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [loadingGps, setLoadingGps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string>("Initialisation GPS...");
  const [gpsReady, setGpsReady] = useState(false);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canSubmit = useMemo(() => {
    return !!(
      form.country.trim() &&
      form.type.trim() &&
      form.category.trim() &&
      form.name.trim() &&
      form.city.trim() &&
      form.district.trim() &&
      form.lat.trim() &&
      form.lng.trim()
    );
  }, [form]);

  const applyTypePreset = (type: ProviderType) => {
    let category: ProviderCategory = "service";

    if (type === "pharmacy" || type === "clinic") category = "health";
    else if (type === "restaurant") category = "food";
    else if (type === "hotel") category = "lodging";
    else if (type === "administrative") category = "administrative";
    else category = "service";

    setForm((prev) => ({
      ...prev,
      type,
      category,
    }));
  };

  const getCurrentLocation = async () => {
    try {
      setLoadingGps(true);
      setGpsStatus("Récupération de la position...");
      setGpsReady(false);

      const perm = await Location.requestForegroundPermissionsAsync();

      if (!perm.granted) {
        setGpsStatus("GPS refusé");
        Alert.alert(
          "Localisation refusée",
          "L'autorisation GPS est nécessaire pour récupérer automatiquement la position."
        );
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const latitude = loc.coords.latitude;
      const longitude = loc.coords.longitude;

      updateField("lat", String(latitude));
      updateField("lng", String(longitude));

      try {
        const reverse = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });

        if (reverse && reverse.length > 0) {
          const first = reverse[0];

          if (!form.city && first.city) {
            updateField("city", first.city);
          }

          const districtGuess =
            first.district ||
            first.subregion ||
            first.street ||
            first.name ||
            "";

          if (!form.district && districtGuess) {
            updateField("district", districtGuess);
          }

          const addressGuess = [first.streetNumber, first.street]
            .filter(Boolean)
            .join(" ");

          if (!form.address && addressGuess) {
            updateField("address", addressGuess);
          }
        }
      } catch {
        // pas bloquant
      }

      setGpsStatus("Position récupérée");
      setGpsReady(true);
    } catch (e: any) {
      setGpsStatus("Erreur GPS");
      Alert.alert(
        "Erreur GPS",
        e?.message || "Impossible de récupérer la position GPS."
      );
    } finally {
      setLoadingGps(false);
    }
  };

  useEffect(() => {
    getCurrentLocation().catch(() => {});
  }, []);

  const resetForm = () => {
    setForm({
      ...initialForm,
      country: form.country,
      collectorName: form.collectorName,
    });
    setGpsReady(false);
    setGpsStatus("Réinitialisé, récupération GPS...");
  };

  const doSave = async () => {
    const lat = Number(form.lat);
    const lng = Number(form.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      Alert.alert("Coordonnées invalides", "Latitude ou longitude invalide.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        country: form.country,
        type: form.type,
        category: form.category,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        city: form.city.trim(),
        district: form.district.trim(),
        address: form.address.trim() || null,
        lat,
        lng,
        description_short: form.descriptionShort.trim() || null,
        notes: form.notes.trim() || null,
        collector_name: form.collectorName.trim() || null,
        status: "pending",
      };

      const { error } = await supabase.from("providers_pending").insert(payload);

      if (error) throw error;

      Alert.alert("Succès", "Le point a bien été enregistré.");
      resetForm();
      await getCurrentLocation();
    } catch (e: any) {
      Alert.alert(
        "Erreur",
        e?.message || "Impossible d’enregistrer la structure."
      );
    } finally {
      setSaving(false);
    }
  };

  const saveProvider = async () => {
    if (!form.name.trim()) {
      Alert.alert("Champ manquant", "Le nom du lieu est obligatoire.");
      return;
    }

    if (!form.city.trim()) {
      Alert.alert("Champ manquant", "La ville est obligatoire.");
      return;
    }

    if (!form.district.trim()) {
      Alert.alert("Champ manquant", "Le quartier / district est obligatoire.");
      return;
    }

    if (!form.lat.trim() || !form.lng.trim()) {
      Alert.alert(
        "GPS manquant",
        "Appuie sur « Actualiser GPS » avant d’enregistrer."
      );
      return;
    }

    Alert.alert(
      "Confirmer l’enregistrement",
      `Lieu : ${form.name.trim()}\nVille : ${form.city.trim()}\nQuartier : ${form.district.trim()}`,
      [
        { text: "Annuler", style: "cancel" },
        { text: "Enregistrer", onPress: doSave },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>← Retour</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Collecte terrain</Text>
      <Text style={styles.subtitle}>
        Enregistrement enquêteur → providers_pending
      </Text>

      <View style={styles.gpsBox}>
        <Text style={styles.gpsBoxTitle}>État GPS</Text>
        <Text style={[styles.gpsBoxText, gpsReady && styles.gpsReadyText]}>
          {gpsStatus}
        </Text>
        <Text style={styles.gpsTip}>
          Place-toi devant le lieu, attends 2 à 3 secondes, puis appuie sur
          « Actualiser GPS ».
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Pays *</Text>
        <View style={styles.rowWrap}>
          <ChoiceChip
            label="Togo"
            value="TG"
            selectedValue={form.country}
            onPress={(v) => updateField("country", v)}
          />
          <ChoiceChip
            label="Bénin"
            value="BJ"
            selectedValue={form.country}
            onPress={(v) => updateField("country", v)}
          />
          <ChoiceChip
            label="Sénégal"
            value="SN"
            selectedValue={form.country}
            onPress={(v) => updateField("country", v)}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Type *</Text>
        <View style={styles.rowWrap}>
          <ChoiceChip
            label="Pharmacie"
            value="pharmacy"
            selectedValue={form.type}
            onPress={applyTypePreset}
          />
          <ChoiceChip
            label="Clinique"
            value="clinic"
            selectedValue={form.type}
            onPress={applyTypePreset}
          />
          <ChoiceChip
            label="Restaurant"
            value="restaurant"
            selectedValue={form.type}
            onPress={applyTypePreset}
          />
          <ChoiceChip
            label="Hôtel"
            value="hotel"
            selectedValue={form.type}
            onPress={applyTypePreset}
          />
          <ChoiceChip
            label="Administratif"
            value="administrative"
            selectedValue={form.type}
            onPress={applyTypePreset}
          />
          <ChoiceChip
            label="Autre"
            value="other"
            selectedValue={form.type}
            onPress={applyTypePreset}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Catégorie *</Text>
        <View style={styles.rowWrap}>
          <ChoiceChip
            label="Santé"
            value="health"
            selectedValue={form.category}
            onPress={(v) => updateField("category", v)}
          />
          <ChoiceChip
            label="Administratif"
            value="administrative"
            selectedValue={form.category}
            onPress={(v) => updateField("category", v)}
          />
          <ChoiceChip
            label="Alimentation"
            value="food"
            selectedValue={form.category}
            onPress={(v) => updateField("category", v)}
          />
          <ChoiceChip
            label="Hébergement"
            value="lodging"
            selectedValue={form.category}
            onPress={(v) => updateField("category", v)}
          />
          <ChoiceChip
            label="Commerce"
            value="commerce"
            selectedValue={form.category}
            onPress={(v) => updateField("category", v)}
          />
          <ChoiceChip
            label="Service"
            value="service"
            selectedValue={form.category}
            onPress={(v) => updateField("category", v)}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Nom du lieu / structure *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Pharmacie Avédji"
          placeholderTextColor="#777"
          value={form.name}
          onChangeText={(v) => updateField("name", v)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Téléphone</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: +22890000000"
          placeholderTextColor="#777"
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(v) => updateField("phone", v)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Ville *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Lomé"
          placeholderTextColor="#777"
          value={form.city}
          onChangeText={(v) => updateField("city", v)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Quartier / district *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Adidogomé"
          placeholderTextColor="#777"
          value={form.district}
          onChangeText={(v) => updateField("district", v)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Adresse</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: près du marché"
          placeholderTextColor="#777"
          value={form.address}
          onChangeText={(v) => updateField("address", v)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Description courte</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: ouverte 24h/24"
          placeholderTextColor="#777"
          value={form.descriptionShort}
          onChangeText={(v) => updateField("descriptionShort", v)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Observations terrain..."
          placeholderTextColor="#777"
          multiline
          value={form.notes}
          onChangeText={(v) => updateField("notes", v)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Nom du collecteur</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Fousséni"
          placeholderTextColor="#777"
          value={form.collectorName}
          onChangeText={(v) => updateField("collectorName", v)}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>GPS *</Text>
          <Pressable
            style={styles.secondaryBtn}
            onPress={getCurrentLocation}
            disabled={loadingGps}
          >
            {loadingGps ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.secondaryBtnText}>Actualiser GPS</Text>
            )}
          </Pressable>
        </View>

        <TextInput
          style={[styles.input, styles.readOnlyInput]}
          placeholder="Latitude"
          placeholderTextColor="#777"
          value={form.lat}
          editable={false}
          selectTextOnFocus={false}
        />

        <TextInput
          style={[styles.input, styles.readOnlyInput]}
          placeholder="Longitude"
          placeholderTextColor="#777"
          value={form.lng}
          editable={false}
          selectTextOnFocus={false}
        />
      </View>

      <Pressable
        style={[styles.primaryBtn, (!canSubmit || saving) && styles.disabledBtn]}
        onPress={saveProvider}
        disabled={!canSubmit || saving}
      >
        {saving ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.primaryBtnText}>Enregistrer</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  content: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  topBar: {
    marginBottom: 8,
  },
  backBtn: {
    alignSelf: "flex-start",
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
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 6,
  },
  subtitle: {
    color: "#888",
    marginBottom: 20,
  },
  gpsBox: {
    backgroundColor: "#0b0b0b",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  gpsBoxTitle: {
    color: "#fff",
    fontWeight: "800",
    marginBottom: 6,
  },
  gpsBoxText: {
    color: "#bbb",
    marginBottom: 6,
  },
  gpsReadyText: {
    color: "#7CFC98",
  },
  gpsTip: {
    color: "#777",
    fontSize: 12,
    lineHeight: 18,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    color: "#fff",
    fontWeight: "700",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#0b0b0b",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 12,
    color: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  readOnlyInput: {
    color: "#999",
  },
  textarea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  chip: {
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  chipSelected: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  chipText: {
    color: "#fff",
    fontWeight: "700",
  },
  chipTextSelected: {
    color: "#000",
  },
  primaryBtn: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: {
    color: "#000",
    fontWeight: "800",
    fontSize: 16,
  },
  secondaryBtn: {
    backgroundColor: "#111",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 120,
  },
  secondaryBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  disabledBtn: {
    opacity: 0.5,
  },
});
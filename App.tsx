import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  NativeStackNavigationOptions,
} from "@react-navigation/native-stack";

import HomeScreen from "./src/screens/HomeScreen";
import ResultsScreen from "./src/screens/ResultsScreen";
import CollectProviderScreen from "./src/screens/CollectProviderScreen";
import AdminReviewScreen from "./src/screens/AdminReviewScreen";
import GuideScreen from "./src/screens/GuideScreen";

export type RootStackParamList = {
  Home: { autoStartMic?: boolean } | undefined;
  Results: {
    queryText: string;
    intent: "PHARMACY_ON_CALL" | "PHARMACY" | "CLINIC" | "RESTAURANT";
    district: string | null;
    nearLat?: number | null;
    nearLng?: number | null;
  };
  Guide: {
    guideKey: "passport" | "cni" | "casier";
    lang?: "fr" | "mina" | "kabyè";
  };
  CollectProvider: undefined;
  AdminReview: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const screenOptions: NativeStackNavigationOptions = {
  headerShown: false,
};

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        id="root"
        initialRouteName="Home"
        screenOptions={screenOptions}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Results" component={ResultsScreen} />
        <Stack.Screen name="Guide" component={GuideScreen} />
        <Stack.Screen name="CollectProvider" component={CollectProviderScreen} />
        <Stack.Screen name="AdminReview" component={AdminReviewScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
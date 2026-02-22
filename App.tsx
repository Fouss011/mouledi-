import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, NativeStackNavigationOptions } from "@react-navigation/native-stack";

import HomeScreen from "./src/screens/HomeScreen";
import ResultsScreen from "./src/screens/ResultsScreen";
import type { Intent } from "./src/lib/nlu";

export type RootStackParamList = {
  Home: undefined;
  Results: {
    queryText: string;
    intent: "PHARMACY_ON_CALL" | "PHARMACY" | "CLINIC";
    district: string | null;
    nearLat?: number;
    nearLng?: number;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();


const screenOptions: NativeStackNavigationOptions = {
  headerShown: false,
};

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator id="root" initialRouteName="Home" screenOptions={screenOptions}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Results" component={ResultsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

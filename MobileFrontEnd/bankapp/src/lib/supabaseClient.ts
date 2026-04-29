import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { createClient } from "@supabase/supabase-js";

const config = Constants.expoConfig?.extra ?? {};
export const supabaseUrl = config.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = config.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.");
}

const webStorage = {
  getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
  setItem: (key: string, value: string) => {
    localStorage.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key);
    return Promise.resolve();
  },
};

export const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    storage: Platform.OS === "web" ? webStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: Platform.OS !== "web",
    detectSessionInUrl: false,
  },
});

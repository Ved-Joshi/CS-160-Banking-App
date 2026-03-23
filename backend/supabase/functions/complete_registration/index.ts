import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

type RegistrationPayload = {
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  mobile_phone_e164: string;
  street_address: string;
  apartment_unit?: string | null;
  city: string;
  state: string;
  zip_code: string;
  date_of_birth: string;
  tax_identifier_raw: string;
};

const FUNCTION_VERSION = "2026-03-23-1";
const REQUIRED_FIELDS: (keyof RegistrationPayload)[] = [
  "email",
  "username",
  "first_name",
  "last_name",
  "mobile_phone_e164",
  "street_address",
  "city",
  "state",
  "zip_code",
  "date_of_birth",
  "tax_identifier_raw",
];
const ALLOWED_FIELDS = new Set<string>([
  "email",
  "username",
  "first_name",
  "last_name",
  "mobile_phone_e164",
  "street_address",
  "apartment_unit",
  "city",
  "state",
  "zip_code",
  "date_of_birth",
  "tax_identifier_raw",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ version: FUNCTION_VERSION, ...body }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const getEnv = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
};

const getEnvAny = (keys: string[]) => {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value) return value;
  }
  throw new Error(`Missing ${keys.join(" or ")}`);
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizeUsername = (username: string) => username.trim().toLowerCase();
const normalizeState = (state: string) => state.trim().toUpperCase();
const normalizePhone = (phone: string) => {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return `+${digits}`;
};
const normalizeZip = (zip: string) => zip.trim();

const isAdult = (dob: string) => {
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  const cutoff = new Date(
    today.getFullYear() - 18,
    today.getMonth(),
    today.getDate(),
  );
  return date <= cutoff;
};

const stripDigits = (value: string) => value.replace(/\D/g, "");

const base64Encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes));

const encryptTaxId = async (raw: string, keyB64: string) => {
  const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) {
    throw new Error("ENCRYPTION_KEY_B64 must be 32 bytes (base64)");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(raw);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return `${base64Encode(iv)}.${base64Encode(ciphertext)}`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  let payload: RegistrationPayload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  const unknown = Object.keys(payload).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length > 0) {
    return json(400, { ok: false, error: `Unknown fields: ${unknown.join(", ")}` });
  }

  const missing = REQUIRED_FIELDS.filter(
    (key) => !payload[key] || String(payload[key]).trim() === "",
  );

  if (missing.length > 0) {
    return json(400, { ok: false, error: `Missing: ${missing.join(", ")}` });
  }

  const email = normalizeEmail(payload.email);
  const username = normalizeUsername(payload.username);
  const state = normalizeState(payload.state);
  const phone = normalizePhone(payload.mobile_phone_e164);
  const zip = normalizeZip(payload.zip_code);
  const taxDigits = stripDigits(payload.tax_identifier_raw);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { ok: false, error: "Invalid email" });
  }
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return json(400, { ok: false, error: "Invalid username" });
  }
  if (!/^\+[0-9]{10,15}$/.test(phone)) {
    return json(400, { ok: false, error: "Invalid phone" });
  }
  if (!/^[0-9]{5}(-[0-9]{4})?$/.test(zip)) {
    return json(400, { ok: false, error: "Invalid ZIP" });
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    return json(400, { ok: false, error: "Invalid state" });
  }
  if (!isAdult(payload.date_of_birth)) {
    return json(400, { ok: false, error: "User must be at least 18" });
  }
  if (taxDigits.length !== 9) {
    return json(400, { ok: false, error: "Invalid tax identifier" });
  }

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return json(401, { ok: false, error: "Missing Authorization token" });
  }

  let supabaseUrl: string;
  let serviceRoleKey: string;
  let encryptionKey: string;
  try {
    supabaseUrl = getEnvAny(["SB_URL", "SUPABASE_URL"]);
    serviceRoleKey = getEnvAny(["SB_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
    encryptionKey = getEnv("REGISTRATION_ENCRYPTION_KEY_B64");
  } catch (err) {
    return json(500, { ok: false, error: (err as Error).message });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(
    token,
  );
  if (userError || !userData.user) {
    return json(401, { ok: false, error: "Invalid auth session" });
  }

  const user = userData.user;

  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile) {
    return json(409, { ok: false, error: "Profile already exists" });
  }

  const taxCiphertext = await encryptTaxId(taxDigits, encryptionKey);
  const taxLast4 = taxDigits.slice(-4);

  const { error: profileError, data: profileRows } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: user.id,
      email,
      username,
      first_name: payload.first_name.trim(),
      last_name: payload.last_name.trim(),
      mobile_phone_e164: phone,
      street_address: payload.street_address.trim(),
      apartment_unit: payload.apartment_unit?.trim() || null,
      city: payload.city.trim(),
      state,
      zip_code: zip,
      date_of_birth: payload.date_of_birth,
      onboarding_status: "mfa_pending",
      mfa_required: true,
    })
    .select("id, email, username, onboarding_status")
    .single();

  if (profileError) {
    const urlHost = (() => {
      try {
        return new URL(supabaseUrl).host;
      } catch {
        return "unknown";
      }
    })();
    if (profileError.code === "23505") {
      return json(409, { ok: false, error: "Username or phone already exists" });
    }
    return json(400, {
      ok: false,
      error: profileError.message,
      phone_normalized: phone,
      phone_length: phone.length,
      phone_codepoints: Array.from(phone).map((c) => c.charCodeAt(0)),
      supabase_host: urlHost,
    });
  }

  const { error: privateError } = await supabaseAdmin
    .from("customer_private")
    .insert({
      user_id: user.id,
      tax_identifier_ciphertext: taxCiphertext,
      tax_identifier_last4: taxLast4,
      encryption_key_version: 1,
    });

  if (privateError) {
    await supabaseAdmin.from("profiles").delete().eq("id", user.id);
    return json(400, { ok: false, error: privateError.message });
  }

  return json(200, { ok: true, profile: profileRows });
});

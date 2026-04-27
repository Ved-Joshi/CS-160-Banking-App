import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

type RegistrationPayload = {
  email: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  mobile_phone_e164: string;
  street_address: string;
  apartment_unit?: string | null;
  city: string;
  state: string;
  zip_code: string;
  date_of_birth: string;
};

const FUNCTION_VERSION = "2026-04-27-ssn-removed";
const REQUIRED_FIELDS: (keyof RegistrationPayload)[] = [
  "email",
  "first_name",
  "last_name",
  "mobile_phone_e164",
  "street_address",
  "city",
  "state",
  "zip_code",
  "date_of_birth",
];
const ALLOWED_FIELDS = new Set<string>([
  "email",
  "first_name",
  "middle_name",
  "last_name",
  "mobile_phone_e164",
  "street_address",
  "apartment_unit",
  "city",
  "state",
  "zip_code",
  "date_of_birth",
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

const getEnvAny = (keys: string[]) => {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value) return value;
  }
  throw new Error(`Missing ${keys.join(" or ")}`);
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();
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

const normalizeOptionalName = (value?: string | null) => {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
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
  const state = normalizeState(payload.state);
  const phone = normalizePhone(payload.mobile_phone_e164);
  const zip = normalizeZip(payload.zip_code);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { ok: false, error: "Invalid email" });
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

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return json(401, { ok: false, error: "Missing Authorization token" });
  }

  let supabaseUrl: string;
  let serviceRoleKey: string;
  try {
    supabaseUrl = getEnvAny(["SB_URL", "SUPABASE_URL"]);
    serviceRoleKey = getEnvAny(["SB_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
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

  // MFA is disabled for this build; bypass any multi-factor enrollment requirement.
  const allowSkipMfa = true;

  const { error: profileError, data: profileRows } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: user.id,
      email,
      first_name: payload.first_name.trim(),
      middle_name: normalizeOptionalName(payload.middle_name),
      last_name: payload.last_name.trim(),
      mobile_phone_e164: phone,
      street_address: payload.street_address.trim(),
      apartment_unit: payload.apartment_unit?.trim() || null,
      city: payload.city.trim(),
      state,
      zip_code: zip,
      date_of_birth: payload.date_of_birth,
      onboarding_status: allowSkipMfa ? "active" : "mfa_pending",
      mfa_required: !allowSkipMfa,
    })
    .select("id, email, first_name, middle_name, last_name, onboarding_status")
    .single();

  if (profileError) {
    if (profileError.code === "23505") {
      return json(409, { ok: false, error: "Phone already exists" });
    }
    return json(400, { ok: false, error: profileError.message });
  }

  return json(200, { ok: true, profile: profileRows });
});

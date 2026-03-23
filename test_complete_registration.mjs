import { createClient } from "@supabase/supabase-js";

const url = "https://saihahmznaokaplxlfiu.supabase.co";
const anon = process.env.SUPABASE_ANON_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

if (!anon || !email || !password) {
  console.error(
    "Missing env vars. Set SUPABASE_ANON_KEY, TEST_EMAIL, and TEST_PASSWORD.",
  );
  process.exit(1);
}

const supabase = createClient(url, anon);

const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});

if (error || !data.session) {
  console.error("signIn error", error);
  process.exit(1);
}

const randomPhone = `+1415555${Math.floor(Math.random() * 9000 + 1000)}`;

const res = await fetch(`${url}/functions/v1/complete_registration`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${data.session.access_token}`,
    apikey: anon,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    username: `test_user_${Date.now()}`,
    first_name: "Test",
    last_name: "User",
    mobile_phone_e164: randomPhone,
    street_address: "1 Main St",
    apartment_unit: null,
    city: "San Francisco",
    state: "CA",
    zip_code: "94105",
    date_of_birth: "2000-01-01",
    tax_identifier_raw: "123456789",
  }),
});

console.log(res.status);
console.log(await res.text());

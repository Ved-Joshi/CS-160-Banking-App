// Supabase Edge Function placeholder for secure registration.
// Replace TODOs with validation + encryption + inserts per the plan.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // TODO: parse and validate payload
  // TODO: encrypt SSN/TIN and insert into customer_private
  // TODO: insert profile row and return profile summary

  return new Response(
    JSON.stringify({ ok: false, error: "Not Implemented" }),
    { status: 501, headers: { "Content-Type": "application/json" } },
  );
});

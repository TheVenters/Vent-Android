import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const payload = await req.json();
    const email = String(payload?.email || "").trim().toLowerCase();
    const token = String(payload?.token || "").trim();
    const newPassword = String(payload?.newPassword || "");

    if (!email || !token || !newPassword) {
      return jsonResponse(400, { error: "email, token, and newPassword are required." });
    }

    if (newPassword.length < 6) {
      return jsonResponse(400, { error: "Password must be at least 6 characters." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(500, {
        error: "Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.",
      });
    }

    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let verification = await publicClient.auth.verifyOtp({
      email,
      token,
      type: "recovery",
    });

    // Some projects use the generic `email` OTP type in customized templates.
    if (verification.error || !verification.data?.user?.id) {
      verification = await publicClient.auth.verifyOtp({
        email,
        token,
        type: "email",
      });
    }

    if (verification.error || !verification.data?.user?.id) {
      return jsonResponse(400, {
        error: verification.error?.message || "Invalid or expired reset code.",
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      verification.data.user.id,
      { password: newPassword },
    );

    if (updateError) {
      return jsonResponse(400, { error: updateError.message });
    }

    return jsonResponse(200, { success: true });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
});

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

const maskEmail = (email: string) => {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "invalid-email";
  const left = localPart.slice(0, 1);
  const right = localPart.length > 2 ? localPart.slice(-1) : "";
  return `${left}***${right}@${domain}`;
};

const logResetEvent = (
  level: "log" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
) => {
  console[level](
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...details,
    }),
  );
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let maskedEmail = "unknown";

  const finish = (
    status: number,
    body: Record<string, unknown>,
    event: string,
    level: "log" | "warn" | "error" = "log",
    details: Record<string, unknown> = {},
  ) => {
    logResetEvent(level, event, {
      request_id: requestId,
      status,
      elapsed_ms: Date.now() - startedAt,
      email: maskedEmail,
      ...details,
    });
    return jsonResponse(status, body);
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return finish(405, { error: "Method not allowed." }, "invalid_method", "warn", {
      method: req.method,
    });
  }

  try {
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return finish(400, { error: "Invalid JSON body." }, "invalid_json", "warn");
    }

    const email = String(payload?.email || "").trim().toLowerCase();
    const token = String(payload?.token || "").trim();
    const newPassword = String(payload?.newPassword || "");
    maskedEmail = maskEmail(email);

    if (!email || !token || !newPassword) {
      return finish(
        400,
        { error: "email, token, and newPassword are required." },
        "invalid_payload",
        "warn",
      );
    }

    if (newPassword.length < 6) {
      return finish(
        400,
        { error: "Password must be at least 6 characters." },
        "weak_password",
        "warn",
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return finish(
        500,
        {
          error:
            "Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.",
        },
        "missing_env",
        "error",
      );
    }

    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let verificationType: "recovery" | "email" = "recovery";
    let verification = await publicClient.auth.verifyOtp({
      email,
      token,
      type: "recovery",
    });

    // Some projects use the generic `email` OTP type in customized templates.
    if (verification.error || !verification.data?.user?.id) {
      verificationType = "email";
      verification = await publicClient.auth.verifyOtp({
        email,
        token,
        type: "email",
      });
    }

    if (verification.error || !verification.data?.user?.id) {
      return finish(
        400,
        {
          error: verification.error?.message || "Invalid or expired reset code.",
        },
        "otp_verify_failed",
        "warn",
        { verification_type: verificationType },
      );
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
      return finish(
        400,
        { error: updateError.message },
        "password_update_failed",
        "warn",
        { user_id: verification.data.user.id },
      );
    }

    return finish(200, { success: true }, "password_reset_success", "log", {
      user_id: verification.data.user.id,
      verification_type: verificationType,
    });
  } catch (error) {
    return finish(
      500,
      {
        error: error instanceof Error ? error.message : "Unexpected error.",
      },
      "unexpected_error",
      "error",
    );
  }
});

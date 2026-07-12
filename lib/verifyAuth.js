const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

async function verifyToken(authHeader) {
  const token = (authHeader || "").startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return { error: "Sign in to generate a deck.", status: 401 };
  }

  if (!supabaseAdmin) {
    console.warn("⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; skipping token verification (dev only).");
    return { userId: null };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return { error: "Your session expired, please sign in again.", status: 401 };
  }

  return { userId: data.user.id };
}

module.exports = { verifyToken };
// listing-public — backend for the public /listing/:token page a sales agent
// sends to a potential buyer.
//
// The buyer has no account and never will, so this function is deliberately
// unauthenticated (verify_jwt = false) and runs with the service role. That
// makes it the whole security boundary for the feature, so it does two things
// carefully:
//
//   1. It NEVER returns a row. It builds a hand-picked public payload from the
//      asset. purchase_price in particular is what the dealer PAID — shipping
//      that to a buyer would hand them the margin. Same for notes,
//      linked_client_id, registered_by, admin_id and external_ref.
//   2. It writes only through two SECURITY DEFINER RPCs that are granted to
//      service_role alone (see 20260813140000). Everything attribution depends
//      on — which agent, which lead — is decided in the database from the
//      token, never from the request body.
//
//   POST { action: "view",    token }
//   POST { action: "enquire", token, full_name, phone?, email?, message? }
//
// @ts-nocheck — Deno runtime globals are not known to the app's TS config.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A link that has already taken this many enquiries is being hammered, not
// used. The agent has the buyer's details many times over by then.
const MAX_ENQUIRIES_PER_LINK = 25;

// Tokens are 22 base64url chars from create_asset_share_link. Reject anything
// else before it reaches the database.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const clean = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
};

/** SHA-256 of the caller's IP + the token, hex. Never the address itself: the
 *  agent needs to know a link was opened twice, not who by. Salting with the
 *  token stops one viewer being correlated across different agents' links. */
async function hashIp(ip: string, token: string): Promise<string | null> {
  if (!ip) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${token}:${ip}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function callerIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || "").trim();
}

/** Images are stored as [{url}] by ingest-assets but hand-entered rows have
 *  been seen holding bare strings. Normalise, and keep only http(s) so the page
 *  cannot be pointed at a javascript: or data: URI through the asset record. */
function publicImages(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const item of list) {
    const url = typeof item === "string" ? item : (item?.url ?? item?.src);
    if (typeof url !== "string") continue;
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) out.push(trimmed);
    if (out.length >= 12) break;
  }
  return out;
}

/** The buyer-facing view of an asset. Allowlisted field by field — a column
 *  added to public.assets later must be named here to become public. */
function publicAsset(asset: any) {
  const meta = asset?.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  const attributes = meta?.attributes && typeof meta.attributes === "object" ? meta.attributes : {};

  // Spec pairs the buyer actually cares about, from real columns first.
  const specs: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    if (specs.length >= 14) return;
    specs.push({ label, value: String(value).slice(0, 120) });
  };

  push("Make", asset.make);
  push("Model", asset.model);
  push("Year", asset.year);
  push("Colour", asset.color);
  push("Property type", asset.property_type);
  push("Size", asset.property_size);
  for (const [k, v] of Object.entries(attributes)) {
    if (typeof v === "object") continue;
    push(k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), v);
  }

  return {
    id: asset.id,
    reference: asset.asset_code ?? null,
    title: asset.description ?? "Listing",
    type: asset.asset_type ?? "other",
    // selling_price only. purchase_price is the dealer's cost.
    price: asset.selling_price != null ? Number(asset.selling_price) : null,
    currency: "KES",
    location: asset.location ?? null,
    status: asset.asset_status ?? null,
    specifications: typeof asset.specifications === "string"
      ? asset.specifications.slice(0, 4000)
      : null,
    images: publicImages(asset.images),
    specs,
  };
}

/** Tell the agent an enquiry landed. Best-effort: a mail outage must not lose
 *  the enquiry, which is already committed by the time we get here. */
async function notifyAgent(payload: {
  agentEmail?: string | null;
  agentPhone?: string | null;
  agentName?: string | null;
  assetName: string;
  buyerName: string;
  buyerPhone?: string | null;
  buyerEmail?: string | null;
  message?: string | null;
  origin: string;
}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SERVICE_ROLE}`,
  };

  if (payload.agentEmail) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "listing_enquiry",
          to: payload.agentEmail,
          data: {
            agentName: payload.agentName,
            assetName: payload.assetName,
            buyerName: payload.buyerName,
            buyerPhone: payload.buyerPhone,
            buyerEmail: payload.buyerEmail,
            message: payload.message,
            portalUrl: `${payload.origin}/sales-agent-portal`,
          },
        }),
      });
    } catch (e) {
      console.warn("listing-public: enquiry email failed:", (e as Error).message);
    }
  }

  if (payload.agentPhone) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "custom",
          to: payload.agentPhone,
          message:
            `New enquiry on ${payload.assetName}: ${payload.buyerName}` +
            (payload.buyerPhone ? ` (${payload.buyerPhone})` : "") +
            `. It's in your portal as a new lead.`,
        }),
      });
    } catch (e) {
      console.warn("listing-public: enquiry SMS failed:", (e as Error).message);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error("listing-public: service credentials not configured");
    return json({ error: "Server not configured." }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const action = clean(body?.action, 20);
  const token = clean(body?.token, 64);

  if (!token || !TOKEN_RE.test(token)) {
    return json({ error: "This link is not valid." }, 404);
  }

  // Resolve the link. Every branch below answers with the same generic wording
  // for missing / revoked / expired so the token space cannot be probed.
  const { data: link, error: linkErr } = await admin
    .from("asset_share_links")
    .select("id, asset_id, agent_id, admin_id, note, is_active, expires_at, enquiry_count, recipient_name")
    .eq("token", token)
    .maybeSingle();

  if (linkErr) {
    console.error("listing-public: link lookup failed:", linkErr.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }

  if (!link || !link.is_active || (link.expires_at && new Date(link.expires_at) < new Date())) {
    return json({ error: "This link has expired or been withdrawn." }, 404);
  }

  // ── view ──────────────────────────────────────────────────────────────────
  if (action === "view") {
    const { data: asset } = await admin
      .from("assets")
      .select(
        "id, asset_code, asset_type, description, selling_price, asset_status, location, " +
        "make, model, year, color, property_type, property_size, specifications, images, metadata",
      )
      .eq("id", link.asset_id)
      .maybeSingle();

    if (!asset) {
      return json({ error: "This listing is no longer available." }, 404);
    }

    const { data: agent } = await admin
      .from("agents")
      .select("full_name, phone, email, agent_code")
      .eq("id", link.agent_id)
      .maybeSingle();

    const { data: company } = await admin
      .from("company_profiles")
      .select("company_name, phone, email")
      .eq("admin_id", link.admin_id)
      .maybeSingle();

    const ipHash = await hashIp(callerIp(req), token);
    // Fire-and-forget would be simpler, but the count is the point of the
    // feature for the agent, so wait for it and just swallow a failure.
    try {
      await admin.rpc("record_share_link_view", {
        p_link_id: link.id,
        p_ip_hash: ipHash,
        p_user_agent: req.headers.get("user-agent") || null,
        p_referrer: req.headers.get("referer") || null,
      });
    } catch (e) {
      console.warn("listing-public: view not recorded:", (e as Error).message);
    }

    // asset_status is ('available','reserved','sold','under_maintenance'). A
    // reserved item is still worth showing — deals fall through — but a sold or
    // off-the-road one must not take enquiries.
    const status = String(asset.asset_status || "").toLowerCase();
    const sold = status === "sold" || status === "under_maintenance";

    return json({
      asset: publicAsset(asset),
      // The buyer is talking to a person, not a company inbox. This card is the
      // whole point of an agent-attributed link.
      agent: {
        name: agent?.full_name ?? null,
        phone: agent?.phone ?? null,
        email: agent?.email ?? null,
        code: agent?.agent_code ?? null,
      },
      company: {
        name: company?.company_name ?? null,
        phone: company?.phone ?? null,
        email: company?.email ?? null,
      },
      note: link.note ?? null,
      addressedTo: link.recipient_name ?? null,
      available: !sold,
      // Closed to enquiries once sold, or once the link has clearly been abused.
      acceptingEnquiries: !sold && (link.enquiry_count ?? 0) < MAX_ENQUIRIES_PER_LINK,
    });
  }

  // ── enquire ───────────────────────────────────────────────────────────────
  if (action === "enquire") {
    if ((link.enquiry_count ?? 0) >= MAX_ENQUIRIES_PER_LINK) {
      return json({ error: "This link is no longer accepting enquiries." }, 429);
    }

    const fullName = clean(body?.full_name, 120);
    const phone = clean(body?.phone, 30);
    const email = clean(body?.email, 160);
    const message = clean(body?.message, 1000);

    if (!fullName) return json({ error: "Please tell us your name." }, 400);
    if (!phone && !email) {
      return json({ error: "Please leave a phone number or an email address." }, 400);
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "That email address does not look right." }, 400);
    }

    // The database decides the agent and the lead, from the token. Nothing the
    // buyer submits can redirect the attribution.
    const { data: result, error: rpcErr } = await admin.rpc("record_share_link_enquiry", {
      p_token: token,
      p_full_name: fullName,
      p_phone: phone,
      p_email: email,
      p_message: message,
    });

    if (rpcErr) {
      console.error("listing-public: enquiry failed:", rpcErr.message);
      return json({ error: "We could not send that just now. Please try again." }, 500);
    }

    const origin = req.headers.get("origin") || "";
    await notifyAgent({
      agentEmail: result?.agent_email,
      agentPhone: result?.agent_phone,
      agentName: result?.agent_name,
      assetName: result?.asset_name || "a listing",
      buyerName: fullName,
      buyerPhone: phone,
      buyerEmail: email,
      message,
      origin,
    });

    return json({
      ok: true,
      agentName: result?.agent_name ?? null,
      agentPhone: result?.agent_phone ?? null,
    });
  }

  return json({ error: "Unknown action." }, 400);
});

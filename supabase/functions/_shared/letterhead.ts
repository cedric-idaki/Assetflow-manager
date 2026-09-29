// The sending business's letterhead, for emailed documents.
//
// Receipts, invoices, payment confirmations and statements go out by email as
// well as on paper, and used to be headed with whatever company name the
// browser sent — usually a placeholder, since staff and clients cannot read
// company_profiles. Here the letterhead is resolved SERVER-SIDE, as the calling
// user, through public.get_tenant_letterhead(): the same record the printed
// documents use, and nothing the request body can dress up. A caller cannot put
// another business's logo, or an arbitrary image, into an email this function
// sends from our domain.
//
// Service-role callers (scheduled fan-outs) have no tenant of their own and get
// null; so does anything that fails — the email then goes out as it always did.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Caller } from "./auth.ts";
import { bearerFrom } from "./auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

export type EmailLetterhead = {
  name: string;
  motto: string;
  logoUrl: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  kraPin: string;
  registrationNo: string;
};

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** HTML-escape a value for an email body or attribute. */
export const escapeHtml = (v: unknown): string =>
  str(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Public URL of a stored logo — built here, never taken from a request. */
const logoUrlFor = (path: string): string => {
  if (!path || !SUPABASE_URL) return "";
  // Paths are "<uuid>/<name>.(png|jpg|jpeg)" — the table's own CHECK enforces
  // it — but encode each segment anyway so nothing can break the attribute.
  const safe = path.split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/tenant-branding/${safe}`;
};

export async function letterheadForCaller(req: Request, caller: Caller): Promise<EmailLetterhead | null> {
  if (caller.kind !== "user" || !SUPABASE_URL || !ANON_KEY) return null;
  try {
    const client = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${bearerFrom(req)}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc("get_tenant_letterhead", { p_admin_id: null });
    if (error || !data || !str(data.name)) return null;
    return {
      name: str(data.name),
      motto: str(data.motto),
      logoUrl: logoUrlFor(str(data.logo_path)),
      phone: str(data.phone),
      email: str(data.email),
      website: str(data.website).replace(/^https?:\/\//i, "").replace(/\/+$/, ""),
      address: [str(data.physical_address), str(data.postal_address)].filter(Boolean).join(" · "),
      kraPin: str(data.kra_pin),
      registrationNo: str(data.registration_no),
    };
  } catch (err) {
    console.warn("letterhead: lookup failed; sending unbranded", String(err));
    return null;
  }
}

/** "Tel: … · email · website" — how to reach the business. */
export const contactLine = (lh: EmailLetterhead | null): string =>
  lh ? [lh.phone ? `Tel: ${lh.phone}` : "", lh.email, lh.website].filter(Boolean).join(" · ") : "";

/**
 * The letterhead as the first block of an email card: logo, name, motto,
 * address and contact line, centred. Escaped throughout.
 */
export const letterheadEmailBlock = (lh: EmailLetterhead | null): string => {
  if (!lh) return "";
  const contact = contactLine(lh);
  const ids = [
    lh.registrationNo ? `Reg No: ${lh.registrationNo}` : "",
    lh.kraPin ? `KRA PIN: ${lh.kraPin}` : "",
  ].filter(Boolean).join(" · ");
  return `
  <div style="text-align:center;padding:0 0 18px;margin:0 0 20px;border-bottom:1px solid #e5e7eb">
    ${lh.logoUrl ? `<img src="${escapeHtml(lh.logoUrl)}" alt="${escapeHtml(lh.name)}" style="display:block;margin:0 auto 10px;max-height:64px;max-width:200px;height:auto;width:auto">` : ""}
    <p style="margin:0;font-size:18px;font-weight:700;color:#111827">${escapeHtml(lh.name)}</p>
    ${lh.motto ? `<p style="margin:4px 0 0;font-size:13px;font-style:italic;color:#6b7280">${escapeHtml(lh.motto)}</p>` : ""}
    ${lh.address ? `<p style="margin:6px 0 0;font-size:12px;color:#6b7280">${escapeHtml(lh.address)}</p>` : ""}
    ${contact ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280">${escapeHtml(contact)}</p>` : ""}
    ${ids ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280">${escapeHtml(ids)}</p>` : ""}
  </div>`;
};

import { supabase } from '../lib/supabase';

/**
 * The platform certificate serial for a signable document.
 *
 * Four flows seal a PDF — the e-signature screen's multi-signer path, its two
 * legacy single-signature paths, and in-person walk-in signing — and each one
 * appends the same Electronic Signature Certificate page. They all mint through
 * here so one document has exactly one serial no matter which door it left by:
 * esign_certificate_serial() is idempotent per (table, document), so a
 * re-seal returns the serial the document already carries.
 *
 * `source` is the same discriminator the signing screens already pass around:
 *   'company'   → company_contracts
 *   'esign_doc' → esign_documents
 *   'contract'  → generated_contracts
 *
 * Returns null rather than throwing. Sealing a signed document must not fail
 * because the register was unreachable — the signature is the thing being
 * protected, and a certificate page without a serial is what we had before.
 */
export const mintEsignSerial = async (source, documentId) => {
  if (!documentId) return null;
  try {
    const { data, error } = await supabase.rpc('esign_certificate_serial', {
      p_source: source || 'contract',
      p_document_id: documentId,
    });
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.warn('esign_certificate_serial:', e.message);
    return null;
  }
};

export default mintEsignSerial;

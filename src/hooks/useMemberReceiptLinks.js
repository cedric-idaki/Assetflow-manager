import { useEffect, useState } from 'react';
import { fetchReceiptLinks } from '../services/saccoReceiptService';

const NONE = { bySchedule: new Map(), byShareTxn: new Map() };

/**
 * Which of a member's instalments and share purchases the society has
 * receipted, so a download can hand over the official receipt instead of a
 * document redrawn from the schedule or the share ledger.
 *
 * `refreshKey` is anything that changes when a new receipt may exist — the
 * number of paid instalments, the number of share movements. Best-effort: on a
 * database without the receipt book every lookup simply finds nothing.
 */
export const useMemberReceiptLinks = (memberId, refreshKey) => {
  const [links, setLinks] = useState(NONE);

  useEffect(() => {
    if (!memberId) { setLinks(NONE); return undefined; }
    let live = true;
    fetchReceiptLinks({ memberId })
      .then((found) => { if (live) setLinks(found); })
      .catch(() => { if (live) setLinks(NONE); });
    return () => { live = false; };
  }, [memberId, refreshKey]);

  return links;
};

export default useMemberReceiptLinks;

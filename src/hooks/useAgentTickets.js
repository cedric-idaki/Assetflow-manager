import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { auditLogsService } from '../services/supabaseService';
import { sendTicketOpened, sendTicketReply, sendTicketStatus } from '../services/emailService';

// Module-level counter — see realtime channel naming convention.
let _agentTicketsChannelSeq = 0;

// Tickets are how a bronze agent and a gold agent talk inside the system. An
// assist request carries one note and then goes quiet; a ticket keeps the whole
// exchange — what was asked, what was answered, what was agreed — attached to
// the thing it is about.
//
// A ticket addressed to nobody sits in the gold-agent pool: every gold agent
// sees it until one claims it.

export const TICKET_CATEGORIES = [
  { value: 'onboarding',   label: 'Onboarding help', icon: 'UserCog' },
  { value: 'lead_support', label: 'Lead support',    icon: 'Target' },
  { value: 'commission',   label: 'Commission',      icon: 'Wallet' },
  { value: 'training',     label: 'Training',        icon: 'GraduationCap' },
  { value: 'system',       label: 'System issue',    icon: 'Bug' },
  { value: 'other',        label: 'Something else',  icon: 'MessageSquare' },
];

export const TICKET_PRIORITIES = [
  { value: 'low',    label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high',   label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const OPEN_STATUSES = ['open', 'in_progress', 'waiting'];

// What a status change reads as in the thread, so the history is one column of
// prose rather than dates with nothing behind them.
const SYSTEM_LINE = {
  resolved:    'marked this resolved',
  closed:      'closed this ticket',
  waiting:     'is waiting on the other agent',
  in_progress: 'reopened this ticket',
};

const AGENT_COLS = 'id, full_name, agent_code, region, email, phone, agent_plan';

const portalUrl = () =>
  (typeof window !== 'undefined' ? `${window.location.origin}/sales-agent-portal` : '');

// Email is the catch-up channel for an agent who is not looking at the portal.
// A bounced mailbox must never fail the message that was actually sent.
const notify = (send) => {
  Promise.resolve()
    .then(send)
    .catch(err => console.error('ticket notification failed:', err?.message));
};

export const useAgentTickets = (agentProfile) => {
  const agentId = agentProfile?.id || null;
  const isGold  = (agentProfile?.agent_plan || '') === 'gold';

  const [tickets, setTickets]           = useState([]);
  const [messages, setMessages]         = useState({});   // ticketId → message[]
  const [reads, setReads]               = useState({});   // ticketId → last_read_at
  const [directory, setDirectory]       = useState([]);   // agents a ticket can be sent to
  const [loading, setLoading]           = useState(true);
  // A failed load and an empty inbox render identically once the rows are gone,
  // and "no ticket needs you" is the one an agent believes — so say which it is.
  const [error, setError]               = useState(null);
  const [messagesLoading, setMsgLoading] = useState(false);
  const channelsRef = useRef([]);
  // Which threads are on screen. The realtime handler is created once per
  // agent, so reading `messages` inside it would read the value it had at
  // subscribe time — i.e. always empty, and no reply would ever land live.
  const loadedThreadsRef = useRef(new Set());

  // ── Fetch ──────────────────────────────────────────────────────────────────
  // RLS returns all three sides at once: tickets this agent opened, tickets
  // assigned to them, and (for gold agents) the unclaimed pool.
  const fetchTickets = useCallback(async (id = agentId) => {
    if (!id) return;
    try {
      const { data, error: err } = await supabase
        .from('agent_tickets')
        .select(
          `*,
           opener:agents!agent_tickets_opened_by_agent_id_fkey(${AGENT_COLS}),
           assignee:agents!agent_tickets_assigned_agent_id_fkey(${AGENT_COLS})`
        )
        .order('last_message_at', { ascending: false });
      if (err) throw err;
      setTickets(data || []);
      setError(null);
    } catch (err) {
      // The embed depends on the FK constraint names. Losing the counterpart's
      // name is not worth losing the tickets — fall back to bare rows and
      // stitch the people on separately.
      console.error('fetchTickets embed failed, retrying flat:', err?.message);
      try {
        const { data, error: flatErr } = await supabase
          .from('agent_tickets')
          .select('*')
          .order('last_message_at', { ascending: false });
        if (flatErr) throw flatErr;

        const rows = data || [];
        const ids  = [...new Set(rows.flatMap(r => [r.opened_by_agent_id, r.assigned_agent_id]).filter(Boolean))];
        let byId = {};
        if (ids.length) {
          const { data: people } = await supabase.from('agents').select(AGENT_COLS).in('id', ids);
          byId = Object.fromEntries((people || []).map(p => [p.id, p]));
        }
        setTickets(rows.map(r => ({
          ...r,
          opener:   byId[r.opened_by_agent_id] || null,
          assignee: byId[r.assigned_agent_id]  || null,
        })));
        setError(null);
      } catch (flatErr) {
        console.error('fetchTickets error:', flatErr?.message);
        setTickets([]);
        setError(flatErr?.message || 'Could not load tickets.');
      }
    }
  }, [agentId]);

  const fetchReads = useCallback(async (id = agentId) => {
    if (!id) return;
    try {
      const { data, error: err } = await supabase
        .from('agent_ticket_reads')
        .select('ticket_id, last_read_at')
        .eq('agent_id', id);
      if (err) throw err;
      setReads(Object.fromEntries((data || []).map(r => [r.ticket_id, r.last_read_at])));
    } catch (err) {
      console.error('fetchReads error:', err?.message);
    }
  }, [agentId]);

  // Who a ticket can be addressed to. Every agent the super admin put on a tier
  // is reachable; a bronze agent can also leave it unassigned for the pool.
  const fetchDirectory = useCallback(async (id = agentId) => {
    try {
      let q = supabase
        .from('agents')
        .select(AGENT_COLS)
        .in('agent_plan', ['bronze', 'gold']);
      if (id) q = q.neq('id', id);
      const { data, error: err } = await q.order('full_name', { ascending: true });
      if (err) throw err;
      setDirectory(data || []);
    } catch (err) {
      console.error('fetchDirectory error:', err?.message);
      setDirectory([]);
    }
  }, [agentId]);

  const fetchMessages = useCallback(async (ticketId) => {
    if (!ticketId) return [];
    setMsgLoading(true);
    loadedThreadsRef.current.add(ticketId);
    try {
      const { data, error: err } = await supabase
        .from('agent_ticket_messages')
        .select(`*, sender:agents!agent_ticket_messages_sender_agent_id_fkey(${AGENT_COLS})`)
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });
      if (err) throw err;
      setMessages(prev => ({ ...prev, [ticketId]: data || [] }));
      return data || [];
    } catch (err) {
      console.error('fetchMessages embed failed, retrying flat:', err?.message);
      try {
        const { data, error: flatErr } = await supabase
          .from('agent_ticket_messages')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: true });
        if (flatErr) throw flatErr;
        setMessages(prev => ({ ...prev, [ticketId]: data || [] }));
        return data || [];
      } catch (flatErr) {
        console.error('fetchMessages error:', flatErr?.message);
        return [];
      }
    } finally {
      setMsgLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    if (!agentId) { setLoading(false); return; }
    setLoading(true);
    await Promise.allSettled([fetchTickets(agentId), fetchReads(agentId), fetchDirectory(agentId)]);
    setLoading(false);
  }, [agentId, fetchTickets, fetchReads, fetchDirectory]);

  useEffect(() => {
    if (agentId) loadAll();
  }, [agentId]);

  // ── Realtime ───────────────────────────────────────────────────────────────
  // A realtime filter matches one column, so each way a ticket can reach this
  // agent needs its own handler. Gold agents also listen unfiltered for the
  // pool — RLS decides what actually arrives.
  useEffect(() => {
    if (!agentId) return;
    const t = ++_agentTicketsChannelSeq;

    const ticketsChannel = supabase.channel(`agent_tickets_${agentId}_${t}`);
    ticketsChannel
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'agent_tickets', filter: `assigned_agent_id=eq.${agentId}` },
        () => fetchTickets(agentId))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'agent_tickets', filter: `opened_by_agent_id=eq.${agentId}` },
        () => fetchTickets(agentId));
    if (isGold) {
      ticketsChannel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'agent_tickets' },
        () => fetchTickets(agentId));
    }
    ticketsChannel.subscribe();

    // Replies: unfiltered because a message carries no agent column to filter
    // on. RLS only delivers messages on tickets this agent can already read.
    const messagesChannel = supabase
      .channel(`agent_ticket_messages_${agentId}_${t}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_ticket_messages' },
        (payload) => {
          const ticketId = payload?.new?.ticket_id;
          if (!ticketId) return;
          fetchTickets(agentId);
          // Only refresh a thread that has been opened; the rest are fetched
          // when the agent opens them.
          if (loadedThreadsRef.current.has(ticketId)) fetchMessages(ticketId);
        })
      .subscribe();

    channelsRef.current = [ticketsChannel, messagesChannel];
    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [agentId, isGold]);

  // ── Who the other side is ──────────────────────────────────────────────────
  const counterpartOf = useCallback((ticket) => {
    if (!ticket) return null;
    return ticket.opened_by_agent_id === agentId ? ticket.assignee : ticket.opener;
  }, [agentId]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  // The ticket and its first message are written by one RPC: a subject with
  // nothing under it reads as an agent who asked for help and said nothing.
  const openTicket = useCallback(async ({
    subject, body, assignedAgentId, category, priority, assistId, adminName,
  }) => {
    if (!agentId) throw new Error('Agent profile not ready. Please refresh the page.');
    if (!subject?.trim()) throw new Error('Give the ticket a subject.');
    if (!body?.trim())    throw new Error('Say what you need in the first message.');
    if (isGold && !assignedAgentId) throw new Error('Choose the agent this ticket is for.');

    const { data, error: err } = await supabase.rpc('open_agent_ticket', {
      p_subject:    subject.trim(),
      p_body:       body.trim(),
      p_assigned:   assignedAgentId || null,
      p_category:   category || 'other',
      p_priority:   priority || 'normal',
      p_assist_id:  assistId || null,
      p_admin_name: adminName || null,
    });
    if (err) throw err;
    const ticket = Array.isArray(data) ? data[0] : data;

    await auditLogsService.log(
      'create',
      'agent_tickets',
      `Agent ${agentProfile?.agent_code || ''} opened ticket ${ticket?.ticket_no || ''}: ${subject.trim()}`,
      ticket?.id,
      null,
      { subject, category, priority, assigned_agent_id: assignedAgentId, agent_code: agentProfile?.agent_code }
    );

    // Named recipient gets the email. An unassigned ticket goes to every gold
    // agent — the pool exists so nobody has to guess who is free, and a pool
    // ticket nobody is told about is the silence this replaces.
    const payload = {
      ticketNo:    ticket?.ticket_no,
      subject:     subject.trim(),
      body:        body.trim(),
      category,
      priority,
      fromName:    agentProfile?.full_name,
      fromCode:    agentProfile?.agent_code,
      fromTier:    agentProfile?.agent_plan || 'bronze',
      fromPhone:   agentProfile?.phone,
      fromEmail:   agentProfile?.email,
      adminName,
      portalUrl:   portalUrl(),
    };
    const recipients = assignedAgentId
      ? directory.filter(a => a.id === assignedAgentId)
      : directory.filter(a => a.agent_plan === 'gold');
    recipients.filter(r => r?.email).forEach(r => {
      notify(() => sendTicketOpened(r.email, { ...payload, toName: r.full_name, isPool: !assignedAgentId }));
    });

    await Promise.allSettled([fetchTickets(agentId), fetchReads(agentId)]);
    return ticket;
  }, [agentId, agentProfile, isGold, directory, fetchTickets, fetchReads]);

  const replyToTicket = useCallback(async (ticket, body) => {
    if (!agentId) throw new Error('Agent profile not ready.');
    if (!body?.trim()) throw new Error('Write a message first.');
    const ticketId = ticket?.id || ticket;

    const { data, error: err } = await supabase
      .from('agent_ticket_messages')
      .insert({ ticket_id: ticketId, sender_agent_id: agentId, body: body.trim() })
      .select()
      .maybeSingle();
    if (err) throw err;

    const other = counterpartOf(ticket);
    if (other?.email) {
      notify(() => sendTicketReply(other.email, {
        toName:    other.full_name,
        ticketNo:  ticket?.ticket_no,
        subject:   ticket?.subject,
        body:      body.trim(),
        fromName:  agentProfile?.full_name,
        fromCode:  agentProfile?.agent_code,
        portalUrl: portalUrl(),
      }));
    }

    await Promise.allSettled([fetchMessages(ticketId), fetchTickets(agentId)]);
    return data;
  }, [agentId, agentProfile, counterpartOf, fetchMessages, fetchTickets]);

  // Gold side: take an unclaimed ticket out of the pool. The RPC locks the row,
  // so the agent who pressed second is told rather than silently ignored.
  const claimTicket = useCallback(async (ticket) => {
    const ticketId = ticket?.id || ticket;
    const { data, error: err } = await supabase.rpc('claim_agent_ticket', { p_ticket: ticketId });
    if (err) throw err;
    const claimed = Array.isArray(data) ? data[0] : data;

    const opener = ticket?.opener;
    if (opener?.email) {
      notify(() => sendTicketStatus(opener.email, {
        toName:    opener.full_name,
        ticketNo:  ticket?.ticket_no,
        subject:   ticket?.subject,
        status:    'claimed',
        actorName: agentProfile?.full_name,
        actorCode: agentProfile?.agent_code,
        portalUrl: portalUrl(),
      }));
    }
    await auditLogsService.log(
      'update', 'agent_tickets',
      `Gold agent ${agentProfile?.agent_code || ''} claimed ticket ${ticket?.ticket_no || ''}`,
      ticketId, null, { agent_code: agentProfile?.agent_code }
    );

    await Promise.allSettled([fetchTickets(agentId), fetchMessages(ticketId)]);
    return claimed;
  }, [agentId, agentProfile, fetchTickets, fetchMessages]);

  // Resolve / close / reopen / park. The note becomes a line in the thread so
  // the history reads in one column instead of dates with nothing behind them.
  const setTicketStatus = useCallback(async (ticket, status, note) => {
    const ticketId = ticket?.id || ticket;
    const patch = { status };
    if (status === 'resolved' && note) patch.resolution = note;

    // A closed ticket refuses new messages, so the order matters: the closing
    // note has to go in while the ticket is still open, and the reopening note
    // only after it is open again. Getting this backwards silently loses the
    // one line that says why.
    const postNote = async () => {
      if (!SYSTEM_LINE[status]) return;
      const line = note ? `${SYSTEM_LINE[status]} — ${note}` : SYSTEM_LINE[status];
      const { error: msgErr } = await supabase
        .from('agent_ticket_messages')
        .insert({ ticket_id: ticketId, sender_agent_id: agentId, body: line, is_system: true });
      if (msgErr) console.error('ticket status note failed:', msgErr?.message);
    };

    if (status === 'closed') await postNote();

    const { data, error: err } = await supabase
      .from('agent_tickets')
      .update(patch)
      .eq('id', ticketId)
      .select()
      .maybeSingle();
    if (err) throw err;

    if (status !== 'closed') await postNote();

    const other = counterpartOf(ticket);
    if (other?.email) {
      notify(() => sendTicketStatus(other.email, {
        toName:    other.full_name,
        ticketNo:  ticket?.ticket_no,
        subject:   ticket?.subject,
        status,
        note,
        actorName: agentProfile?.full_name,
        actorCode: agentProfile?.agent_code,
        portalUrl: portalUrl(),
      }));
    }
    await auditLogsService.log(
      'update', 'agent_tickets',
      `Agent ${agentProfile?.agent_code || ''} set ticket ${ticket?.ticket_no || ''} to ${status}${note ? ` — ${note}` : ''}`,
      ticketId, null, { status, note, agent_code: agentProfile?.agent_code }
    );

    await Promise.allSettled([fetchTickets(agentId), fetchMessages(ticketId)]);
    return data;
  }, [agentId, agentProfile, counterpartOf, fetchTickets, fetchMessages]);

  const markTicketRead = useCallback(async (ticketId) => {
    if (!agentId || !ticketId) return;
    const now = new Date().toISOString();
    setReads(prev => ({ ...prev, [ticketId]: now }));   // optimistic: clears the dot at once
    const { error: err } = await supabase
      .from('agent_ticket_reads')
      .upsert({ ticket_id: ticketId, agent_id: agentId, last_read_at: now },
              { onConflict: 'ticket_id,agent_id' });
    if (err) console.error('markTicketRead error:', err?.message);
  }, [agentId]);

  // Open a thread: load it and stop it counting as unread in the same act.
  const openThread = useCallback(async (ticket) => {
    const ticketId = ticket?.id || ticket;
    if (!ticketId) return [];
    const rows = await fetchMessages(ticketId);
    markTicketRead(ticketId);
    return rows;
  }, [fetchMessages, markTicketRead]);

  // ── Buckets — what the badge and the panel both read ───────────────────────
  const isUnread = useCallback((t) => {
    if (!t?.last_message_at) return false;
    const seen = reads[t.id];
    return !seen || new Date(t.last_message_at) > new Date(seen);
  }, [reads]);

  const ticketBuckets = (() => {
    const all      = tickets || [];
    const open     = all.filter(t => OPEN_STATUSES.includes(t.status));
    // Assigned to me and still live — the work I owe an answer on.
    const assigned = open.filter(t => t.assigned_agent_id === agentId);
    // I raised it and it is still live — what I am waiting on.
    const raised   = open.filter(t => t.opened_by_agent_id === agentId);
    // The pool: nobody has taken it yet. Mine are already in `raised`.
    const pool     = open.filter(t => !t.assigned_agent_id && t.opened_by_agent_id !== agentId);
    const closed   = all.filter(t => ['resolved', 'closed'].includes(t.status));
    const unread   = all.filter(isUnread);

    return {
      all, assigned, raised, pool, closed, unread,
      // The header badge: threads with something in them this agent has not
      // read, plus unclaimed tickets nobody has picked up yet.
      unreadCount: unread.length,
      actionable:  new Set([...unread.map(t => t.id), ...pool.map(t => t.id)]).size,
      awaitingMe:  assigned.filter(t => t.status !== 'waiting').length,
    };
  })();

  return {
    tickets,
    ticketBuckets,
    ticketMessages: messages,
    ticketDirectory: directory,
    ticketsLoading: loading,
    ticketMessagesLoading: messagesLoading,
    ticketsError: error,
    isGoldAgent: isGold,
    isTicketUnread: isUnread,
    counterpartOf,
    openTicket,
    replyToTicket,
    claimTicket,
    setTicketStatus,
    markTicketRead,
    openThread,
    fetchTicketMessages: fetchMessages,
    refetchTickets: () => loadAll(),
  };
};

export default useAgentTickets;

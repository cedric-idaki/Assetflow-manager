import React, { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';

const formatTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const MessagingPanel = ({ renewal, currentUser }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Fetch messages for this renewal/document ──
  const fetchMessages = useCallback(async () => {
    if (!renewal?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('kyc_messages')
        .select('*')
        .eq('document_id', renewal.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      // Table may not exist yet — show empty state, don't crash
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [renewal?.id]);

  useEffect(() => {
    fetchMessages();

    if (!renewal?.id) return;

    // Realtime subscription for new messages
    const channel = supabase
      .channel(`kyc_messages_${renewal.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'kyc_messages',
        filter: `document_id=eq.${renewal.id}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new]);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [renewal?.id, fetchMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mark unread messages as read
  useEffect(() => {
    const unreadIds = messages
      .filter(m => !m.is_read && m.sender_role !== 'compliance')
      .map(m => m.id);
    if (!unreadIds.length) return;
    supabase
      .from('kyc_messages')
      .update({ is_read: true })
      .in('id', unreadIds)
      .then(() => {});
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() && attachments.length === 0) return;
    setSending(true);
    try {
      const msgData = {
        document_id: renewal.id,
        client_id: renewal.clientId,
        sender_name: currentUser?.name || 'Compliance Team',
        sender_role: 'compliance',
        sender_id: currentUser?.id || null,
        message_text: newMessage.trim(),
        is_read: false,
        attachments: attachments.map(f => ({ name: f.name, size: f.size })),
        created_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('kyc_messages')
        .insert(msgData)
        .select()
        .single();

      if (error) {
        // If table doesn't exist, show optimistic message locally
        if (error.message?.includes('relation') || error.message?.includes('does not exist')) {
          setMessages(prev => [...prev, { ...msgData, id: `local_${Date.now()}` }]);
        } else {
          throw error;
        }
      }

      setNewMessage('');
      setAttachments([]);
    } catch (err) {
      console.error('Send message error:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileAttach = (e) => {
    const files = Array.from(e.target.files || []);
    setAttachments(prev => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const unreadCount = messages.filter(m => !m.is_read && m.sender_role !== 'compliance').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Icon name="MessageSquare" size={16} color="var(--color-primary)" />
          <span className="text-sm font-semibold text-foreground">Messages</span>
          {unreadCount > 0 && (
            <span className="flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-red-500 text-white">
              {unreadCount}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{renewal?.clientName}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <svg className="animate-spin w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400">
            <Icon name="MessageSquare" size={32} color="currentColor" />
            <p className="mt-3 text-sm font-medium">No messages yet</p>
            <p className="text-xs mt-1">Start the conversation below</p>
          </div>
        ) : (
          messages.map(msg => {
            const isCompliance = msg.sender_role === 'compliance';
            return (
              <div key={msg.id} className={`flex ${isCompliance ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%] space-y-1">
                  <div className={`flex items-center gap-2 ${isCompliance ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      isCompliance ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                    }`}>
                      {(msg.sender_name || '?')[0]}
                    </div>
                    <span className="text-xs text-muted-foreground">{msg.sender_name}</span>
                  </div>
                  <div className={`px-3 py-2 rounded-2xl text-sm ${
                    isCompliance
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted text-foreground rounded-tl-sm'
                  }`}>
                    {msg.message_text && <p>{msg.message_text}</p>}
                    {msg.attachments?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.attachments.map((att, i) => (
                          <div key={i} className={`flex items-center gap-1.5 text-xs ${
                            isCompliance ? 'text-primary-foreground/80' : 'text-muted-foreground'
                          }`}>
                            <Icon name="Paperclip" size={11} color="currentColor" />
                            <span>{att.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={`flex items-center gap-1 ${isCompliance ? 'justify-end' : ''}`}>
                    <span className="text-xs text-muted-foreground">{formatTime(msg.created_at)}</span>
                    {isCompliance && (
                      <Icon name={msg.is_read ? 'CheckCheck' : 'Check'} size={11}
                        color={msg.is_read ? '#3b82f6' : 'var(--color-muted-foreground)'} />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Attachments Preview */}
      {attachments.length > 0 && (
        <div className="px-4 py-2 border-t border-border flex flex-wrap gap-2">
          {attachments.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-lg text-xs text-foreground">
              <Icon name="Paperclip" size={11} color="currentColor" />
              <span className="max-w-[100px] truncate">{f.name}</span>
              <button onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-red-500">
                <Icon name="X" size={11} color="currentColor" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-border flex-shrink-0">
        <div className="flex items-end gap-2">
          <button onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg hover:bg-muted transition-smooth text-muted-foreground hover:text-foreground flex-shrink-0"
            title="Attach file">
            <Icon name="Paperclip" size={16} color="currentColor" />
          </button>
          <input ref={fileInputRef} type="file" multiple onChange={handleFileAttach} className="hidden" />
          <textarea
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send)"
            rows={1}
            className="flex-1 px-3 py-2 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground resize-none"
          />
          <button onClick={handleSend}
            disabled={sending || (!newMessage.trim() && attachments.length === 0)}
            className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-smooth flex-shrink-0">
            {sending
              ? <Icon name="Loader2" size={16} color="currentColor" className="animate-spin" />
              : <Icon name="Send" size={16} color="currentColor" />
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default MessagingPanel;

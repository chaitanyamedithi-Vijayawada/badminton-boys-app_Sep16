import { useState, useEffect } from 'react';
import { Megaphone, X, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface BroadcastMessage {
  id: number;
  content: string;
  sent_by: string;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const DISMISSED_KEY = 'lb_dismissed_broadcasts';

function getDismissed(): Set<number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<number>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
}

export default function BroadcastBanner() {
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(getDismissed);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    supabase
      .from('broadcast_messages')
      .select('id, content, sent_by, created_at')
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data) setMessages(data);
      });

    const channel = supabase
      .channel('broadcast_messages_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, (payload) => {
        setMessages(prev => [payload.new as BroadcastMessage, ...prev].slice(0, 10));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const visible = messages.filter(m => {
    if (dismissed.has(m.id)) return false;
    const age = Date.now() - new Date(m.created_at).getTime();
    return age < SIX_HOURS_MS;
  });
  if (visible.length === 0) return null;

  const latest = visible[0];
  const rest = visible.slice(1);

  const dismiss = (id: number) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    saveDismissed(next);
    if (rest.length === 0) setExpanded(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div
        className="broadcast-flash w-full max-w-sm rounded-2xl overflow-hidden border border-purple-500/60"
        style={{ background: 'linear-gradient(135deg, rgba(88,28,135,0.95) 0%, rgba(59,7,100,0.98) 100%)', boxShadow: '0 0 40px rgba(168,85,247,0.3), 0 20px 60px rgba(0,0,0,0.5)' }}
      >
        {/* header */}
        <div className="px-4 pt-4 pb-3 border-b border-purple-500/20">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-purple-500/30 flex items-center justify-center flex-shrink-0">
              <Megaphone size={15} className="text-purple-300" />
            </div>
            <span className="text-sm font-bold text-purple-200 tracking-wide uppercase">Announcement</span>
          </div>
        </div>

        {/* latest message */}
        <div className="px-4 pt-3 pb-3">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-semibold text-purple-300">{latest.sent_by}</span>
                <span className="text-xs text-purple-500">{timeAgo(latest.created_at)}</span>
              </div>
              <p className="text-sm text-white leading-relaxed">{latest.content}</p>
            </div>
            <button
              onClick={() => dismiss(latest.id)}
              className="flex-shrink-0 w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-purple-400 hover:text-white transition-colors ml-1"
            >
              <X size={14} />
            </button>
          </div>

          {rest.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-200 mt-2 transition-colors"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Hide older' : `+${rest.length} more`}
            </button>
          )}
        </div>

        {/* older messages */}
        {expanded && rest.length > 0 && (
          <div className="border-t border-purple-500/20 px-4 pb-3 pt-2 flex flex-col gap-2">
            {rest.map(msg => (
              <div key={msg.id} className="flex items-start gap-2 pt-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-semibold text-purple-400">{msg.sent_by}</span>
                    <span className="text-xs text-purple-600">{timeAgo(msg.created_at)}</span>
                  </div>
                  <p className="text-xs text-purple-200 leading-snug">{msg.content}</p>
                </div>
                <button
                  onClick={() => dismiss(msg.id)}
                  className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-purple-500 hover:text-purple-300 transition-colors"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* dismiss all footer */}
        <div className="px-4 pb-4 pt-1">
          <button
            onClick={() => {
              const next = new Set(dismissed);
              visible.forEach(m => next.add(m.id));
              setDismissed(next);
              saveDismissed(next);
              setExpanded(false);
            }}
            className="w-full py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-xs font-semibold text-purple-300 hover:text-white transition-all border border-purple-500/30"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { Download, Printer, Share2, Mail, ChevronDown } from 'lucide-react';
import type { MatchRound } from '../../types';
import { formatRoundText, formatFullScheduleText } from '../../lib/matchScheduler';

interface ExportMenuProps {
  rounds: MatchRound[];
  currentRoundIndex: number;
  sessionName: string;
  dateStr: string;
  playerCount: number;
  courts: number[];
  gamesPlayed: Record<string, number>;
}

export default function ExportMenu({
  rounds,
  currentRoundIndex,
  sessionName,
  dateStr,
  playerCount,
  courts,
  gamesPlayed,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentRound = rounds[currentRoundIndex];
  if (!currentRound || rounds.length === 0) return null;

  const getCurrentRoundText = () =>
    formatRoundText(currentRound, sessionName, dateStr, playerCount, courts);

  const getFullScheduleText = () =>
    formatFullScheduleText(rounds, sessionName, dateStr, playerCount, courts, gamesPlayed);

  const handleShare = async (text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch (_) { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
    }
    setOpen(false);
  };

  const handlePrint = (text: string) => {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<pre style="font-family:monospace;font-size:14px;padding:20px;white-space:pre-wrap">${text}</pre>`);
      win.document.close();
      win.print();
    }
    setOpen(false);
  };

  const handleEmail = (text: string, subject: string) => {
    const body = encodeURIComponent(text);
    const subj = encodeURIComponent(subject);
    window.location.href = `mailto:?subject=${subj}&body=${body}`;
    setOpen(false);
  };

  const actions = [
    { label: 'Print Current Round', icon: <Printer size={14} />, action: () => handlePrint(getCurrentRoundText()) },
    { label: 'Print Full Schedule', icon: <Printer size={14} />, action: () => handlePrint(getFullScheduleText()) },
    { label: 'Share Current Round', icon: <Share2 size={14} />, action: () => handleShare(getCurrentRoundText()) },
    { label: 'Share Full Schedule', icon: <Share2 size={14} />, action: () => handleShare(getFullScheduleText()) },
    { label: 'Email Current Round', icon: <Mail size={14} />, action: () => handleEmail(getCurrentRoundText(), `${sessionName} - Round ${currentRound.roundNumber}`) },
    { label: 'Email Full Schedule', icon: <Mail size={14} />, action: () => handleEmail(getFullScheduleText(), `${sessionName} - Full Schedule`) },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-700/60 bg-slate-800/60 text-slate-300 hover:text-slate-100 hover:border-cyan-700/40 transition-all"
      >
        <Download size={14} />
        Export
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-1 w-56 bg-slate-900/95 backdrop-blur-xl border border-slate-700/60 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-50 overflow-hidden">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={a.action}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-cyan-900/20 hover:text-cyan-300 transition-all bg-transparent border-none cursor-pointer text-left"
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

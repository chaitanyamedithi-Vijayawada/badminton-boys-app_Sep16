import { useEffect, useRef, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { googleCalendarUrl, openIcs, type CalendarEvent } from '../lib/calendar';

// Small "Add to calendar" button with two choices: Google Calendar (opens a
// pre-filled event) or Apple / Outlook (an .ics file via the share sheet).
export default function AddToCalendar({ event, className = '' }: { event: CalendarEvent; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const googleUrl = googleCalendarUrl(event);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  if (!googleUrl) return null; // times couldn't be read; hide rather than make a wrong event

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-2 py-0.5 mt-1 transition-colors"
      >
        <CalendarPlus size={12} aria-hidden="true" />
        Add to calendar
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-30 min-w-[170px] rounded-xl border border-white/10 bg-slate-900/95 shadow-xl backdrop-blur p-1">
          <a
            role="menuitem"
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block text-xs text-slate-100 px-3 py-2 rounded-lg hover:bg-white/10"
          >
            Google Calendar
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); void openIcs(event); }}
            className="block w-full text-left text-xs text-slate-100 px-3 py-2 rounded-lg hover:bg-white/10"
          >
            Apple / Outlook (.ics)
          </button>
        </div>
      )}
    </div>
  );
}

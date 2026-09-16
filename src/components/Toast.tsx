import { useApp } from '../context/AppContext';

export default function Toast() {
  const { toast } = useApp();
  return (
    <div
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-xl text-slate-100 px-5 py-2.5 rounded-full text-sm font-medium pointer-events-none z-[999] whitespace-nowrap border border-cyan-700/50 shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-opacity duration-300 ${
        toast.visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {toast.message}
    </div>
  );
}

import { Home, Swords, Users, DollarSign, Clock, ShieldCheck ,Trophy} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { TabId } from '../types';


interface NavItemConfig {
  id: TabId;
  label: string;
  icon: LucideIcon;
  
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'sessions',
    label: 'Home',
    icon: Home,
  },
  {
    id: 'match',
    label: 'Match',
    icon: Swords,
  },
  {
    id: 'players',
    label: 'Players',
    icon: Users,
  },
  {
    id: 'fees',
    label: 'Fees',
    icon: DollarSign,
  },
  {
    id: 'history',
    label: 'History',
    icon: Clock,
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: ShieldCheck,
  },
  { 
    id: 'tournament', 
    label: 'Cup', 
    icon: Trophy,
  },
];

export default function BottomNav() {
  const { activeTab, setActiveTab, hiddenTabs } = useApp();

  const visibleItems = NAV_ITEMS.filter(item => !hiddenTabs.includes(item.id));

  return (
    <div className="bottom-nav" style={{
      background: "var(--nav-bg)",
      backdropFilter: 'blur(16px)',
      borderTop: '1px solid var(--nav-border)',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
    }}>
      <div className="flex">
        {visibleItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 px-0.5 border-none bg-transparent cursor-pointer transition-all duration-300 relative ${
                isActive ? '' : 'text-slate-500 hover:text-slate-300'
              }`}
              style={isActive ? { color: 'var(--accent)' } : undefined}
            >
              {isActive && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-[3px] rounded-full bg-current"
                  style={{ boxShadow: '0 0 8px currentColor' }}
                />
              )}
              <span
                className={`relative rounded-xl p-1.5 transition-all duration-300 ${
                  isActive ? 'bg-white/[0.06]' : ''
                }`}
                style={isActive ? { boxShadow: '0 0 12px color-mix(in srgb, var(--accent) 40%, transparent)' } : undefined}
              >
                <Icon
                  size={26}
                  strokeWidth={isActive ? 2.4 : 1.8}
                  className="transition-all duration-300"
                />
                {isActive && (
                  <Icon
                    size={26}
                    strokeWidth={1}
                    className="absolute inset-1.5 opacity-60 blur-[3px] transition-all duration-300"
                    style={{ color: 'var(--accent)' }}
                  />
                )}
              </span>
              <span className={`font-display text-[11px] font-semibold leading-tight tracking-[0.12em] uppercase transition-all duration-300 ${
                isActive ? 'opacity-100' : 'opacity-50'
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
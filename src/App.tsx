import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import Toast from './components/Toast';
import NamePicker from './components/NamePicker';
import ContentSkeleton from './components/ContentSkeleton';
import PullToRefresh from './components/PullToRefresh';
import SplashScreen from './components/SplashScreen';
import RegularSessionAutoFinalizer from './components/RegularSessionAutoFinalizer';
import HomeTab from './tabs/HomeTab';
// Code-split: only HomeTab (the landing tab) ships in the main bundle.
// Each other tab downloads on first visit; the PWA service worker still
// precaches the chunks in the background for offline use.
const PlayersTab = lazy(() => import('./tabs/PlayersTab'));
const FeesTab = lazy(() => import('./tabs/FeesTab'));
const AdminTab = lazy(() => import('./tabs/AdminTab'));
const HistoryTab = lazy(() => import('./tabs/HistoryTab'));
const MatchTab = lazy(() => import('./tabs/MatchTab'));
import { getSavedTheme, applyTheme } from './lib/constants';

function TabContent() {
  const { activeTab, dataReady } = useApp();

  if (!dataReady) return <ContentSkeleton />;

  return (
    <Suspense fallback={<ContentSkeleton />}>
      {activeTab === 'sessions' && <HomeTab />}
      {activeTab === 'players' && <PlayersTab />}
      {activeTab === 'fees' && <FeesTab />}
      {activeTab === 'history' && <HistoryTab />}
      {activeTab === 'admin' && <AdminTab />}
      {activeTab === 'match' && <MatchTab />}
    </Suspense>
  );
}

function AppInner() {
  const { activeTab, showNamePicker, refreshTab, fontSize } = useApp();
  const [splashDone, setSplashDone] = useState(false);
  const handleSplashDone = useCallback(() => setSplashDone(true), []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}%`;
  }, [fontSize]);

  useEffect(() => {
    const savedTheme = getSavedTheme();
    applyTheme(savedTheme);
  }, []);

  return (
    <>
      {!splashDone && <SplashScreen onDone={handleSplashDone} />}
      
      {/* 1. This acts as your locked mobile background layer */}
      <div 
        className="fixed top-0 left-0 w-full h-[100dvh] -z-10 transition-all duration-500"
        style={{ background: 'var(--top-color)' }}
      />

      {/* 2. Your main app wrapper */}
      <div className="w-full flex justify-center items-center transition-all duration-500" style={{ minHeight: '100dvh' }}>
        <div
          /* 👇 Changed bg-slate-950/20 to bg-slate-950/80 for a much darker glass effect */
          className="app-shell text-slate-100 flex flex-col w-full max-w-[480px] mx-auto relative bg-transparent backdrop-blur-none transition-all duration-300"
          style={{
            height: '100dvh',
            maxHeight: '100dvh',
            overflowX: 'hidden',
            overflowY: 'hidden',
            touchAction: 'pan-y',
            background: 'var(--bg-gradient)',
            borderColor: 'var(--card-border)'
          }}
        >
          <Header showAdmins={activeTab === 'sessions' || activeTab === 'match'} />
          <PullToRefresh onRefresh={refreshTab}>
  <div className="app-content">
    <TabContent />
  </div>
</PullToRefresh>
<BottomNav />
          <Toast />
          <RegularSessionAutoFinalizer />
          {showNamePicker && <NamePicker />}
        </div>
      </div>
    </>
  );
}

export default function App() {
  return <AppProvider><AppInner /></AppProvider>;
}
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StudioProvider, ToastHost, useStudio } from './state/store';
import { Sidebar, Topbar, useHashRoute, type Route } from './components/shell';
import { Dashboard } from './pages/Dashboard';
import { NewVideo } from './pages/NewVideo';
import { ProjectDetail } from './pages/ProjectDetail';
import { Projects, Garage } from './pages/Projects';
import { Library } from './pages/Library';
import { Models, Settings } from './pages/Models';
import { Auth } from './pages/Auth';
import { Agent } from './pages/Agent';
import './studio.css';

const TITLES: Record<Route['name'], { t: string; c?: string }> = {
  dashboard: { t: 'Dashboard' },
  baru: { t: 'Buat Video', c: 'Brief → storyboard → parameter → generate' },
  agen: { t: 'Agen Otonom', c: 'Sembilan tahap berjalan sendiri + metadata otomatis' },
  proyek: { t: 'Proyek Saya' },
  'proyek-detail': { t: 'Detail Proyek', c: 'Pipeline sembilan tahap' },
  perpustakaan: { t: 'Perpustakaan' },
  garasi: { t: 'Garasi' },
  model: { t: 'Model AI' },
  pengaturan: { t: 'Pengaturan' },
};

function Router() {
  const { user, api } = useStudio();
  const [route, go] = useHashRoute();

  if (!user) return <Auth />;

  const meta = TITLES[route.name];

  return (
    <div className="shell">
      <Sidebar route={route} go={go} />
      <div className="main">
        <Topbar
          title={meta.t}
          crumb={meta.c}
          right={
            <div className="row" style={{ gap: 8 }}>
              <span
                className={`chip ${api.kind === 'http' ? 'chip--ok' : 'chip--info'}`}
                title={
                  api.kind === 'http'
                    ? 'Terhubung ke backend repo: login, render, dan unggah berjalan sungguhan'
                    : 'Situs statis: proyek disimpan di peramban dan video tidak dirender di sini'
                }
              >
                <span className="dot" /> {api.kind === 'http' ? 'backend' : 'mode demo (statis)'}
              </span>
              <button className="btn btn--primary btn--sm" onClick={() => go({ name: 'baru' })}>
                Buat Video
              </button>
            </div>
          }
        />
        {route.name === 'dashboard' && <Dashboard go={go} />}
        {route.name === 'baru' && <NewVideo go={go} preselect={route.car} />}
        {route.name === 'agen' && <Agent go={go} />}
        {route.name === 'proyek' && <Projects go={go} />}
        {route.name === 'proyek-detail' && <ProjectDetail id={route.id} go={go} />}
        {route.name === 'perpustakaan' && <Library go={go} />}
        {route.name === 'garasi' && <Garage go={go} />}
        {route.name === 'model' && <Models />}
        {route.name === 'pengaturan' && <Settings />}
      </div>
      <ToastHost />
    </div>
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <StudioProvider>
        <Router />
      </StudioProvider>
    </React.StrictMode>,
  );
}

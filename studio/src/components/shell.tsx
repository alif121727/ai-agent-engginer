import React from 'react';
import { useStudio } from '../state/store';
import { Icon } from './ui';

export type Route =
  | { name: 'dashboard' }
  | { name: 'baru'; car?: string }
  | { name: 'agen' }
  | { name: 'proyek' }
  | { name: 'proyek-detail'; id: string; autoRun?: boolean }
  | { name: 'perpustakaan' }
  | { name: 'garasi' }
  | { name: 'model' }
  | { name: 'pengaturan' };

export function useHashRoute(): [Route, (r: Route) => void] {
  const parse = (): Route => {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const [seg, id] = h.split('/');
    switch (seg) {
      case 'baru': return { name: 'baru', car: id };
      case 'agen': return { name: 'agen' };
      case 'proyek': return id ? { name: 'proyek-detail', id, autoRun: h.split('/')[2] === 'jalankan' } : { name: 'proyek' };
      case 'perpustakaan': return { name: 'perpustakaan' };
      case 'garasi': return { name: 'garasi' };
      case 'model': return { name: 'model' };
      case 'pengaturan': return { name: 'pengaturan' };
      default: return { name: 'dashboard' };
    }
  };
  const [route, setRoute] = React.useState<Route>(parse);
  React.useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = React.useCallback((r: Route) => {
    const h =
      r.name === 'dashboard' ? '#/'
      : r.name === 'proyek-detail' ? `#/proyek/${r.id}${r.autoRun ? '/jalankan' : ''}`
      : r.name === 'baru' && r.car ? `#/baru/${r.car}`
      : `#/${r.name}`;
    if (location.hash === h) setRoute(r);
    else location.hash = h;
  }, []);
  return [route, go];
}

const NAV: Array<{ key: Route['name']; label: string; icon: React.ReactNode }> = [
  { key: 'dashboard', label: 'Dashboard', icon: <Icon.Dashboard size={16} /> },
  { key: 'baru', label: 'Buat Video', icon: <Icon.Plus size={16} /> },
  { key: 'agen', label: 'Agen Otonom', icon: <Icon.Bolt size={16} /> },
  { key: 'proyek', label: 'Proyek Saya', icon: <Icon.Folder size={16} /> },
  { key: 'perpustakaan', label: 'Perpustakaan', icon: <Icon.Library size={16} /> },
  { key: 'garasi', label: 'Garasi', icon: <Icon.Car size={16} /> },
  { key: 'model', label: 'Model AI', icon: <Icon.Spark size={16} /> },
  { key: 'pengaturan', label: 'Pengaturan', icon: <Icon.Gear size={16} /> },
];

export function Sidebar({ route, go }: { route: Route; go: (r: Route) => void }) {
  const { user, logout, projects } = useStudio();
  const active = route.name === 'proyek-detail' ? 'proyek' : route.name;
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__mark">AS</div>
        <div>
          <div className="sidebar__name">Agent Studio AI</div>
          <div className="sidebar__sub">Otomotif</div>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Navigasi utama">
        <div className="sidebar__label">Studio</div>
        {NAV.slice(0, 3).map((n) => (
          <button
            key={n.key}
            className="navitem"
            aria-current={active === n.key ? 'page' : undefined}
            onClick={() => go({ name: n.key } as Route)}
          >
            <span className="navitem__icon">{n.icon}</span>
            {n.label}
            {n.key === 'proyek' && projects.length > 0 && <span className="navitem__badge">{projects.length}</span>}
          </button>
        ))}
        <div className="sidebar__label">Konten</div>
        {NAV.slice(3, 6).map((n) => (
          <button
            key={n.key}
            className="navitem"
            aria-current={active === n.key ? 'page' : undefined}
            onClick={() => go({ name: n.key } as Route)}
          >
            <span className="navitem__icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="sidebar__label">Lainnya</div>
        {NAV.slice(6).map((n) => (
          <button
            key={n.key}
            className="navitem"
            aria-current={active === n.key ? 'page' : undefined}
            onClick={() => go({ name: n.key } as Route)}
          >
            <span className="navitem__icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>

      <div className="sidebar__foot">
        <div className="userchip">
          <div className="userchip__avatar">{(user?.name || '?').slice(0, 2).toUpperCase()}</div>
          <div className="userchip__meta">
            <div className="userchip__name">{user?.name}</div>
            {/* Login demo boleh memakai username, sehingga email == nama.
                Jangan tampilkan baris yang mengulang nama yang sama. */}
            {user?.email && user.email !== user.name && (
              <div className="userchip__mail">{user.email}</div>
            )}
          </div>
          <button className="btn btn--ghost btn--sm" onClick={logout} title="Keluar" aria-label="Keluar">
            <Icon.Logout size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function Topbar({ title, crumb, right }: { title: string; crumb?: string; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <div>
        <div className="topbar__title">{title}</div>
        {crumb && <div className="topbar__crumb">{crumb}</div>}
      </div>
      <div className="topbar__spacer" />
      {right}
    </header>
  );
}

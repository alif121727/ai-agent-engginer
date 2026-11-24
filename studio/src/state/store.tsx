import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { pickApi, demoProjectsKey, rememberDeletion, type Project, type StudioApi } from '../services/api';
import { VIDEO_MODELS } from '../data/models';
import type { Readiness } from '../services/api';

/* ------------------------------------------------------------------ types */
export type User = { name: string; email: string };

type Toast = { id: string; title: string; body?: string; kind?: 'ok' | 'err' | 'info' };

type Ctx = {
  ready: boolean;
  api: StudioApi;
  user: User | null;
  login(account: string, password: string): Promise<{ ok: boolean; error?: string }>;
  register(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string }>;
  logout(): void;
  projects: Project[];
  /** true selama daftar proyek pertama kali diambil dari server. */
  loadingProjects: boolean;
  /** true setelah setidaknya satu pengambilan daftar proyek selesai. */
  projectsLoaded: boolean;
  refresh(): Promise<void>;
  upsert(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
  toasts: Toast[];
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: string): void;
  settings: Settings;
  saveSettings(s: Partial<Settings>): void;
  /**
   * Kesiapan model video menurut server (`null` = mode demo / tidak diketahui).
   * Halaman memakai ini untuk menandai model yang benar-benar bisa jalan.
   */
  readiness: Readiness | null;
  /** true bila model ini punya kredensial di server saat ini. */
  isModelReady(modelId: string): boolean;
};

export type Settings = {
  defaultModel: string;
  language: 'id' | 'en';
  exportQuality: '1080p' | '4K';
  theme: 'dark';
};

const DEFAULTS: Settings = { defaultModel: 'local-render', language: 'id', exportQuality: '1080p', theme: 'dark' };

const StudioCtx = createContext<Ctx | null>(null);
export const useStudio = () => {
  const c = useContext(StudioCtx);
  if (!c) throw new Error('useStudio harus di dalam StudioProvider');
  return c;
};

/* --------------------------------------------------------------- provider */
export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [api, setApi] = useState<StudioApi | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const timers = useRef<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const a = await pickApi();
      setApi(a);
      let stored: User | null = null;
      try {
        const u = localStorage.getItem('asa.user');
        if (u) stored = JSON.parse(u) as User;
        const s = localStorage.getItem('asa.settings');
        if (s) setSettings({ ...DEFAULTS, ...JSON.parse(s) });
      } catch {
        /* localStorage rusak -> mulai bersih */
      }
      // Backend sungguhan adalah sumber kebenaran: cookie bisa kedaluwarsa
      // sementara localStorage masih menyimpan nama pengguna lama.
      if (a.kind === 'http') {
        try {
          const live = await a.currentUser();
          if (live) {
            const u = { email: live.email, name: live.name };
            localStorage.setItem('asa.user', JSON.stringify(u));
            setUser(u);
          } else {
            localStorage.removeItem('asa.user');
          }
        } catch {
          // Server tak terjangkau: jangan buang sesi, biarkan pengguna mencoba.
          if (stored) setUser(stored);
        }
      } else if (stored) {
        setUser(stored);
      }
      setReady(true);
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoadingProjects(true);
    try {
      setProjects(await api.listProjects());
      setProjectsLoaded(true);
    } finally {
      setLoadingProjects(false);
    }
  }, [api]);

  useEffect(() => {
    if (api && user) void refresh();
  }, [api, user, refresh]);

  // Selama ada proyek yang dikerjakan worker, UI harus menyegarkan diri:
  // tanpa polling, progres tahap tidak pernah bergerak karena server yang
  // mengubah status, bukan browser.
  useEffect(() => {
    if (api?.kind !== 'http' || !user) return;
    const active = projects.some((p) => p.status === 'running');
    if (!active) return;
    const t = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(t);
  }, [api, user, projects, refresh]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...t, id }]);
    timers.current[id] = window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 5200);
  }, []);

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current[id]);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const login = useCallback(
    async (account: string, password: string) => {
      if (!api) return { ok: false, error: 'Studio belum siap.' };
      const res = await api.authenticate(account, password);
      if (!res.ok) return res;
      // Nama tampilan diambil dari akun yang benar-benar login di backend.
      const name = account.includes('@') ? account.split('@')[0] : account;
      const u = { email: account, name };
      localStorage.setItem('asa.user', JSON.stringify(u));
      setUser(u);
      return { ok: true };
    },
    [api],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      if (!api) return { ok: false, error: 'Studio belum siap.' };
      const res = await api.register(name, email, password);
      if (!res.ok) return res;
      const u = { email, name };
      localStorage.setItem('asa.user', JSON.stringify(u));
      setUser(u);
      return { ok: true };
    },
    [api],
  );

  const logout = useCallback(() => {
    void api?.logout();
    localStorage.removeItem('asa.user');
    setUser(null);
    setProjects([]);
  }, [api]);

  const upsert = useCallback(
    async (p: Project) => {
      if (!api) return;
      await api.saveProject(p);
      await refresh();
    },
    [api, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!api) return;
      // Mode demo: hapus dari kunci yang sama dengan yang dibaca DemoStudioApi.
      // Backend repo tidak punya rute hapus job, jadi proyek server tetap utuh.
      if (api.kind === 'demo') {
        try {
          const key = demoProjectsKey();
          const all = JSON.parse(localStorage.getItem(key) || '[]') as Project[];
          localStorage.setItem(key, JSON.stringify(all.filter((p) => p.id !== id)));
          // Catat penghapusan proyek benih, supaya tidak muncul lagi saat
          // data benih diperbarui di kemudian hari.
          rememberDeletion(id);
        } catch {
          /* localStorage rusak -> refresh di bawah menampilkan keadaan nyata */
        }
      }
      await refresh();
    },
    [api, refresh],
  );

  const saveSettings = useCallback((s: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...s };
      localStorage.setItem('asa.settings', JSON.stringify(next));
      return next;
    });
  }, []);

  const [readiness, setReadiness] = useState<Ctx['readiness']>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.modelReadiness().then((r) => {
      if (live) setReadiness(r);
    });
    return () => {
      live = false;
    };
  }, [api]);

  const isModelReady = useCallback(
    (modelId: string) => {
      const model = VIDEO_MODELS.find((m) => m.id === modelId);
      if (!model) return false;
      // Render lokal selalu bisa; model vendor hanya bila server punya kunci
      // DAN vendornya masih punya saldo kredit.
      if (!model.provider) return model.ready;
      return readiness?.providers?.[model.provider]?.ready === true;
    },
    [readiness],
  );

  const value = useMemo<Ctx | null>(
    () =>
      api
        ? { ready, api, user, login, register, logout, projects, loadingProjects, projectsLoaded, refresh, upsert, remove, toasts, toast, dismiss, settings, saveSettings, readiness, isModelReady }
        : null,
    [ready, api, user, login, register, logout, projects, loadingProjects, projectsLoaded, refresh, upsert, remove, toasts, toast, dismiss, settings, saveSettings, readiness, isModelReady],
  );

  if (!value) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', gap: 12 }}>
        <div className="skel" style={{ width: 160, height: 8 }} />
        <div className="dim tiny">Menyiapkan studio…</div>
      </div>
    );
  }

  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}

/* ------------------------------------------------------------------ toasts */
export function ToastHost() {
  const { toasts, dismiss } = useStudio();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'ok' ? ' toast--ok' : t.kind === 'err' ? ' toast--err' : ''}`} role="status">
          <div className="row row--between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="toast__title">{t.title}</div>
              {t.body && <div className="dim tiny">{t.body}</div>}
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => dismiss(t.id)} aria-label="Tutup notifikasi">
              <Icon.XInline />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const Icon = { XInline: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg> };

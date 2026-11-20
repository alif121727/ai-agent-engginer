import React from 'react';

/* Ikon inline — tanpa paket ikon, jadi bundle tetap kecil & offline-friendly. */
type IconProps = { size?: number; className?: string };
const S = ({ size = 16, children, className }: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const Icon = {
  Dashboard: (p: IconProps) => (
    <S {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></S>
  ),
  Plus: (p: IconProps) => (<S {...p}><path d="M12 5v14M5 12h14" /></S>),
  Library: (p: IconProps) => (<S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" /></S>),
  Folder: (p: IconProps) => (<S {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></S>),
  Car: (p: IconProps) => (<S {...p}><path d="M5 17h14M6.5 17a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM20.5 17a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" /><path d="M4 17v-3l2-5h12l2 5v3" /></S>),
  Spark: (p: IconProps) => (<S {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" /></S>),
  Gear: (p: IconProps) => (<S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></S>
  ),
  Check: (p: IconProps) => (<S {...p}><path d="M20 6L9 17l-5-5" /></S>),
  X: (p: IconProps) => (<S {...p}><path d="M18 6L6 18M6 6l12 12" /></S>),
  Play: (p: IconProps) => (<S {...p}><path d="M6 4l14 8-14 8z" /></S>),
  Download: (p: IconProps) => (<S {...p}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></S>),
  Retry: (p: IconProps) => (<S {...p}><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" /></S>),
  Skip: (p: IconProps) => (<S {...p}><path d="M5 4l10 8-10 8zM19 4v16" /></S>),
  Warn: (p: IconProps) => (<S {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></S>),
  Info: (p: IconProps) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></S>),
  Search: (p: IconProps) => (<S {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></S>),
  ChevronR: (p: IconProps) => (<S {...p}><path d="M9 6l6 6-6 6" /></S>),
  ChevronL: (p: IconProps) => (<S {...p}><path d="M15 6l-6 6 6 6" /></S>),
  Logout: (p: IconProps) => (<S {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></S>),
  Bell: (p: IconProps) => (<S {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0" /></S>),
  Trash: (p: IconProps) => (<S {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></S>),
  Edit: (p: IconProps) => (<S {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></S>),
  Upload: (p: IconProps) => (<S {...p}><path d="M12 21V9M7 14l5-5 5 5M4 3h16" /></S>),
  Film: (p: IconProps) => (<S {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5" /></S>),
  Bolt: (p: IconProps) => (<S {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></S>),
};

/* --------------------------------------------------------------- primitives */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ animation: 'spin 900ms linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </svg>
  );
}

export function Skeleton({ variant = 'line', w }: { variant?: 'line' | 'title' | 'card'; w?: string; key?: React.Key }) {
  const cls = variant === 'title' ? 'skel skel--title' : variant === 'card' ? 'skel skel--card' : 'skel skel--line';
  return <div className={cls} style={w ? { width: w } : undefined} />;
}

export function EmptyState({ art, title, text, action }: { art: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__art" aria-hidden="true">{art}</div>
      <div className="empty__title">{title}</div>
      <p className="empty__text">{text}</p>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Ada yang gagal', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="empty__art" aria-hidden="true" style={{ background: '#2a1418', borderColor: '#5c222b' }}>
        <Icon.Warn size={28} />
      </div>
      <div className="empty__title">{title}</div>
      <p className="empty__text">{message}</p>
      {onRetry && <button className="btn" onClick={onRetry} style={{ marginTop: 8 }}><Icon.Retry size={14} /> Coba lagi</button>}
    </div>
  );
}

export function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const label = level === 'high' ? 'yakin' : level === 'medium' ? 'sedang' : 'rendah';
  return <span className={`conf conf--${level}`} title={`Keyakinan AI: ${label}`}>{label}</span>;
}

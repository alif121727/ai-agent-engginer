type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';

const color: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

export interface LogSink {
  (entry: { ts: string; level: Level; scope: string; msg: string; data?: unknown }): void;
}

const sinks: LogSink[] = [];

export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

export function logger(scope: string) {
  const emit = (level: Level, msg: string, data?: unknown) => {
    if (order[level] < order[minLevel]) return;
    const ts = new Date().toISOString();
    const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(`${color[level]}${line}\x1b[0m${data === undefined ? '' : ` ${safe(data)}`}\n`);
    for (const sink of sinks) sink({ ts, level, scope, msg, data });
  };
  return {
    debug: (m: string, d?: unknown) => emit('debug', m, d),
    info: (m: string, d?: unknown) => emit('info', m, d),
    warn: (m: string, d?: unknown) => emit('warn', m, d),
    error: (m: string, d?: unknown) => emit('error', m, d),
    child: (sub: string) => logger(`${scope}:${sub}`),
  };
}

function safe(data: unknown): string {
  try {
    const s = typeof data === 'string' ? data : JSON.stringify(data);
    return s.length > 800 ? `${s.slice(0, 800)}…` : s;
  } catch {
    return String(data);
  }
}

export type ProbeResult = 'ok' | 'fail';

export interface ProbeFn {
  (url: string, timeoutMs: number): Promise<ProbeResult>;
}

export const defaultProbe: ProbeFn = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
    // Any HTTP answer proves the network path works, including 401/403 from
    // provider endpoints that require a key.
    return res.status > 0 ? 'ok' : 'fail';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
};

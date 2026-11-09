export interface TrackableResponse {
  once?(event: 'finish' | 'close', listener: () => void): unknown;
}

type IdleHandler = () => void;

const trackedResponses = new WeakSet<object>();
let activeRequests = 0;
let recycleOnNextUse = true;
let idleHandler: IdleHandler | null = null;

export function setFirebaseIdleHandler(handler: IdleHandler | null): void {
  idleHandler = typeof handler === 'function' ? handler : null;
}

export function trackFirebaseRequest(res: TrackableResponse | null | undefined): void {
  if (!res || trackedResponses.has(res)) return;
  trackedResponses.add(res);
  activeRequests += 1;
  let finished = false;
  const done = (): void => {
    if (finished) return;
    finished = true;
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests > 0) return;
    recycleOnNextUse = true;
    try {
      idleHandler?.();
    } catch {
      return;
    }
  };
  if (typeof res.once === 'function') {
    res.once('finish', done);
    res.once('close', done);
  }
}

export function consumeConnectionRecycle(): boolean {
  if (!recycleOnNextUse) return false;
  recycleOnNextUse = false;
  return true;
}

export function firebaseSessionState(): { activeRequests: number; recycleOnNextUse: boolean } {
  return { activeRequests, recycleOnNextUse };
}

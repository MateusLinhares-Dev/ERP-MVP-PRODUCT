import { classNames } from './class-names.js';
import type { ToastMessage } from './use-toast.js';

export function Toast({ toast }: { toast: ToastMessage | null }) {
  return (
    <div
      className={classNames(
        'toast',
        toast?.tone === 'error' && 'error',
        toast?.tone === 'success' && 'success',
      )}
      role="status"
      aria-live="polite"
      hidden={!toast}
    >
      {toast?.text}
    </div>
  );
}

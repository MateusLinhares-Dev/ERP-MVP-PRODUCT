import { payPayable, reversePayablePayment } from '../../server/modules/payables/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 16384,
    handle: ({ identity, body }) =>
      (body as Body | null)?.action === 'reverse'
        ? reversePayablePayment(identity, body as Body)
        : payPayable(identity, body as Body),
  },
});

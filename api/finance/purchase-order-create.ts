import { createPurchaseOrder } from '../../server/modules/purchases/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 131072,
    handle: ({ identity, body }) => createPurchaseOrder(identity, body as Body),
  },
});

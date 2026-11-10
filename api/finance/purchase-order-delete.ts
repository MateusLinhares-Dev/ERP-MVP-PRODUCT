import { deletePurchaseOrder } from '../../server/modules/purchases/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 16384,
    handle: ({ identity, body }) => deletePurchaseOrder(identity, body as Body),
  },
});

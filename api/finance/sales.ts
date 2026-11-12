import { changeSale } from '../../server/modules/sales/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 524288,
    handle: ({ identity, body }) => changeSale(identity, body as Body),
  },
});

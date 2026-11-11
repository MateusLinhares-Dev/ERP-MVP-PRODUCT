import { changeSupplier } from '../../server/modules/suppliers/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 262144,
    handle: ({ identity, body }) => changeSupplier(identity, body as Body),
  },
});

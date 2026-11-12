import { changeCustomer } from '../../server/modules/customers/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 262144,
    handle: ({ identity, body }) => changeCustomer(identity, body as Body),
  },
});

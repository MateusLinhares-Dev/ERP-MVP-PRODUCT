import { listAdvanceBankOptions } from '../../server/modules/advances/index.js';
import { defineApi } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: { access: 'user', handle: ({ identity }) => listAdvanceBankOptions(identity) },
});

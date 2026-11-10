import { listPaymentBanks } from '../../server/modules/payables/index.js';
import { defineApi } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: { access: 'user', handle: ({ identity }) => listPaymentBanks(identity) },
});

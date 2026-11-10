import { inspectPayablePayment } from '../../server/modules/payables/index.js';
import { defineApi, queryParam } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: {
    access: 'user',
    handle: ({ req, identity }) =>
      inspectPayablePayment(identity, {
        payableId: queryParam(req, 'payableId'),
        operationId: queryParam(req, 'operationId') || undefined,
      }),
  },
});

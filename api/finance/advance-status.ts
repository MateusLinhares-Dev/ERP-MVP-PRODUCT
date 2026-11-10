import { getAdvanceOperationStatus } from '../../server/modules/advances/index.js';
import { defineApi, queryParam } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: {
    access: 'user',
    handle: ({ req, identity }) =>
      getAdvanceOperationStatus(identity, {
        operationId: queryParam(req, 'operationId'),
        fornCod: queryParam(req, 'fornCod'),
      }),
  },
});

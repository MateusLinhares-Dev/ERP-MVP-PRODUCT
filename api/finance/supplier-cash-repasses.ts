import {
  changeSupplierCashRepasse,
  listSupplierCashRepasses,
  summarizeSupplierCashRepasses,
} from '../../server/modules/supplier-repasses/index.js';
import { defineApi, queryParam, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: {
    access: 'user',
    handle: ({ req, identity }) =>
      queryParam(req, 'scope') === 'summary'
        ? summarizeSupplierCashRepasses(identity)
        : listSupplierCashRepasses(identity, queryParam(req, 'fornCod')),
  },
  POST: {
    access: 'user',
    maxBodyBytes: 16384,
    handle: ({ identity, body }) => changeSupplierCashRepasse(identity, body as Body),
  },
});

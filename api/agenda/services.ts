import { changeAgendaServices, listAgendaServices } from '../../server/modules/agenda/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

const catalog = () => getFirebaseAdmin().db.ref('erpAgendaServices/catalog');

export default defineApi({
  GET: { access: 'user', handle: ({ identity }) => listAgendaServices(catalog(), identity) },
  POST: {
    access: 'user',
    maxBodyBytes: 2048,
    handle: ({ identity, body }) => changeAgendaServices(catalog(), identity, body as Body),
  },
});

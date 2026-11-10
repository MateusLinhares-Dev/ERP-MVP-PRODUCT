import { changeAdvance } from '../../server/modules/advances/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 8192,
    handle: ({ identity, body }) => changeAdvance(identity, body as Body),
  },
});

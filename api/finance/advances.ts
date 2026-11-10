import { createAdvance } from '../../server/modules/advances/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 65536,
    handle: ({ identity, body }) => createAdvance(identity, body as Body),
  },
});

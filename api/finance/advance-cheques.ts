import { listAdvanceCheques } from '../../server/modules/advances/index.js';
import { defineApi } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: {
    access: 'user',
    handle: ({ res, identity }) => {
      res.setHeader('Cache-Control', 'no-store, private');
      return listAdvanceCheques(identity);
    },
  },
});

import { defineApi, queryParam, RAW_RESPONSE } from '../../server/shared/http/api-handler.js';
import { createQuickEntryModule } from '../../server/modules/quick-entry/index.js';

export default defineApi({
  GET: {
    access: 'user',
    handle: async ({ req, res, identity }) => {
      const file = await createQuickEntryModule().readAttachment(
        identity,
        queryParam(req, 'dono'),
        queryParam(req, 'id'),
      );
      res.setHeader('Content-Type', file.tipo);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.nome)}"`);
      res.status(200).send(file.buffer);
      return RAW_RESPONSE;
    },
  },
  POST: {
    access: 'user',
    maxBodyBytes: 4_400_000,
    handle: ({ identity, body }) => createQuickEntryModule().uploadAttachment(identity, body),
  },
});

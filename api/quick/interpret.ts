import { defineApi } from '../../server/shared/http/api-handler.js';
import { createQuickEntryModule } from '../../server/modules/quick-entry/index.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 16384,
    handle: ({ identity, body }) => createQuickEntryModule().interpretSpeech(identity, body),
  },
});

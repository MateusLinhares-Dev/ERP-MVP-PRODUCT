import { defineApi } from '../../server/shared/http/api-handler.js';
import { createQuickEntryModule } from '../../server/modules/quick-entry/index.js';

export default defineApi({
  GET: { access: 'user', handle: ({ identity }) => createQuickEntryModule().listEntries(identity) },
});

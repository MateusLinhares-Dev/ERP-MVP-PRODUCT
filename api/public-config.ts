import { getPublicBranding } from '../server/modules/company/index.js';
import { defineApi } from '../server/shared/http/api-handler.js';

export default defineApi({
  GET: { access: 'public', handle: () => getPublicBranding() },
});

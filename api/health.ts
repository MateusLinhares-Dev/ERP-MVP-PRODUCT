import { runtimeEnvironment } from '../server/shared/config/runtime-security.js';
import { defineApi } from '../server/shared/http/api-handler.js';

export default defineApi({
  GET: { access: 'public', handle: () => ({ ok: true, environment: runtimeEnvironment() }) },
});

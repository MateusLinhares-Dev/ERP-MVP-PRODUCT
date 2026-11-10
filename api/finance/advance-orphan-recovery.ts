import {
  previewOrphanAdvance,
  recordVerifiedOrphanTransfer,
  recoverOrphanAdvance,
} from '../../server/modules/advances/index.js';
import { fail } from '../../server/shared/errors/app-error.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

const ACTIONS = {
  preview: previewOrphanAdvance,
  confirm: recoverOrphanAdvance,
  'record-bank-transfer': recordVerifiedOrphanTransfer,
} as const;

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 4096,
    handle: ({ identity, body }) => {
      const input = body as Body;
      const action = String(input.action) as keyof typeof ACTIONS;
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, action))
        fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
      return ACTIONS[action](identity, input);
    },
  },
});

import {
  changeTrainingMatrix,
  trainingMatrix,
  trainingNotices,
} from '../../server/modules/training/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi, queryParam, type Body } from '../../server/shared/http/api-handler.js';

const deps = () => {
  const { db, storage } = getFirebaseAdmin();
  return { db, storage };
};

export default defineApi({
  GET: {
    access: 'user',
    handle: ({ req, identity }) =>
      queryParam(req, 'view') === 'mine'
        ? trainingNotices(deps(), identity)
        : trainingMatrix(deps(), identity),
  },
  POST: {
    access: 'user',
    maxBodyBytes: 14000,
    handle: ({ identity, body }) => changeTrainingMatrix(deps(), identity, body as Body),
  },
});

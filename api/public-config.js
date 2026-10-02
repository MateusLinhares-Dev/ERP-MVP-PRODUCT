import '../server/config/load-local-env.js';
import { getPublicBranding } from '../server/application/get-public-branding.js';
import { applyApiSecurityHeaders, assertMethod, sendError } from '../server/http/http.js';

export default async function handler(req, res) {
  try {
    applyApiSecurityHeaders(res);
    assertMethod(req, 'GET');
    const result = await getPublicBranding();
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error);
  }
}

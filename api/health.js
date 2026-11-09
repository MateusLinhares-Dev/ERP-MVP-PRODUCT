import '../server/shared/config/load-local-env.js';
import { applyApiSecurityHeaders, assertMethod } from '../server/shared/http/http.js';
import { runtimeEnvironment } from '../server/shared/config/runtime-security.js';
export default function handler(req,res){
  applyApiSecurityHeaders(res,req)
  try{ assertMethod(req,'GET'); }catch(e){ return res.status(405).json({ok:false}); }
  return res.status(200).json({ok:true,environment:runtimeEnvironment()});
}

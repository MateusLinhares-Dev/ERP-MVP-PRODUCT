import '../server/config/load-local-env.js';
import { applyApiSecurityHeaders, assertMethod } from '../server/http/http.js';
import { runtimeEnvironment } from '../server/config/runtime-security.js';
export default function handler(req,res){
  applyApiSecurityHeaders(res);
  try{ assertMethod(req,'GET'); }catch(e){ return res.status(405).json({ok:false}); }
  return res.status(200).json({ok:true,environment:runtimeEnvironment()});
}

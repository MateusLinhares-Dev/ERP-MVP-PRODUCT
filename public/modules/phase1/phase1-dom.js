(function(global){
'use strict';
const callbacks=new Set();let queued=false;
function flush(){queued=false;callbacks.forEach(fn=>{try{fn();}catch(error){console.warn('[phase1-dom]',error);}});}
function schedule(){if(queued)return;queued=true;if(typeof requestAnimationFrame==='function')requestAnimationFrame(flush);else setTimeout(flush,16);}
function register(fn){if(typeof fn!=='function')return()=>{};callbacks.add(fn);schedule();return()=>callbacks.delete(fn);}
const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{subtree:true,childList:true});
global.Phase1Dom=Object.freeze({register,schedule});
})(window);

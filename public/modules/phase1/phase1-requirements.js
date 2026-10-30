(function(global){
'use strict';
const IMPLEMENTED=[
  'BAL-01','BAL-02','BAL-03','BAL-04','BAL-05','BAL-06','BAL-07',
  'COM-01','COM-02','COM-03','COM-04','COM-05','COM-06','COM-07','COM-08',
  'AGE-01','AGE-02','AGE-03',
  'VEN-01','VEN-02','VEN-03','VEN-04','VEN-05','VEN-06','VEN-07',
  'GER-01','GER-02','GER-03','GER-04','GER-05','GER-06','GER-07','GER-08','GER-09',
  'FIN-01','RN-02','RN-03','FIN-02','RN-04','RN-05','RN-06',
  'RH-01','RH-02','RH-03','FRO-01','VIA-01',
  'FIS-01','FIS-02','ADM-01','ADM-02','ADM-03','ADM-04','ADM-05','ADM-06'
];
const OPEN_DEFINITIONS=[
  {id:'AD-01',reason:'Descontinuações financeiras adicionais além das remoções já aprovadas ainda dependem de definição da contratante.'},
  {id:'AD-03',reason:'Estrutura final da reestruturação maior de RH/Ponto/Folha ainda será definida pela contratante.'}
];
const BLOCKED_BY_OPEN_DEFINITIONS=[
  {id:'RN-07',dependsOn:'AD-03',reason:'A reestruturação maior de RH depende da estrutura final aprovada.'}
];
const OUT_OF_SCOPE=[
  {id:'FIS-03',reason:'Certificado digital/acesso do contador exige aceite comercial/aditivo e não faz parte desta entrega funcional.'}
];
global.Phase1Requirements=Object.freeze({
  version:'2.0',
  implemented:Object.freeze(IMPLEMENTED),
  openDefinitions:Object.freeze(OPEN_DEFINITIONS),
  blockedByOpenDefinitions:Object.freeze(BLOCKED_BY_OPEN_DEFINITIONS),
  outOfScope:Object.freeze(OUT_OF_SCOPE),
  deferred:Object.freeze([...OPEN_DEFINITIONS,...BLOCKED_BY_OPEN_DEFINITIONS,...OUT_OF_SCOPE])
});
})(window);

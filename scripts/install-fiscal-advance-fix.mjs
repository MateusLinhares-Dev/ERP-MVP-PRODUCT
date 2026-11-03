/** Installer idempotente: injeta módulo corretivo no bootstrap EXISTENTE do projeto.
 * Evita substituir bootstrap.js ou app-core.js por versões antigas de pacotes ZIP. */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
const cwd = process.cwd();
const bootstrap = join(cwd, 'public/app/bootstrap.js');
const jsPath = join(cwd, 'public/modules/maintenance/fiscal-advance-fix.js');
const cssPath = join(cwd, 'public/modules/maintenance/fiscal-advance-fix.css');
if (!existsSync(bootstrap) || !existsSync(jsPath) || !existsSync(cssPath)) {
  throw new Error('Execute na raiz do ERP após extrair o ZIP. Bootstrap ou arquivos da correção não encontrados.');
}
const source = readFileSync(bootstrap,'utf8');
if (source.includes("loadClassic('/modules/maintenance/fiscal-advance-fix.js')")) {
  console.log('Correção já registrada em bootstrap.js. Nenhuma alteração adicional.');
  process.exit(0);
}
const anchor = "  await loadClassic('/modules/final-ops/final-ops.js');";
if (!source.includes(anchor)) throw new Error('Ponto de carregamento do ERP não encontrado. Bootstrap não alterado.');
const addition = anchor + "\n  loadStyle('/modules/maintenance/fiscal-advance-fix.css');" +
  "\n  await loadClassic('/modules/maintenance/fiscal-advance-fix.js');";
writeFileSync(bootstrap, source.replace(anchor, addition),'utf8');
console.log('Instalado no bootstrap atual. Revise git diff antes do deploy.');

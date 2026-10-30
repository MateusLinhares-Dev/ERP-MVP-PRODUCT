import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const start = source.indexOf('let _rhidPaginasPendentes = [];');
const end = source.indexOf('function importarCartaoPontoRHiD(input){', start);
const code = source.slice(start, end);

function fixture() {
  let remote = [];
  let reads = 0;
  const opts = { mat: 'F001', nome: 'FUNCIONARIO ANTIGO', status: 'Ativo' };
  const employees = [opts];
  const input = { value: 'FUNCIONARIO ANTIGO (F001)' };
  const combo = { dataset: { open: '0' }, querySelector: () => input };
  const select = {
    innerHTML: '', value: 'F001',
    getAttribute(name) { return name === 'data-rhid-match' ? '0' : null; },
    closest: () => combo,
  };
  const status = { textContent: '' };
  const host = {
    querySelectorAll(sel) { return sel === '[data-rhid-match]' ? [select] : []; },
  };
  const context = {
    document: {
      addEventListener() {},
      getElementById(id) {
        return id === 'ponto-rhid-preview' ? host : id === 'rhid-preview-refresh-status' ? status : null;
      },
    },
    window: {
      _fbDB: {
        ref(path) {
          assert.equal(path, 'erp/funcEdit', 'consulta somente a lista de funcionários');
          return {
            async once(event) {
              assert.equal(event, 'value');
              reads++;
              if (remote instanceof Error) throw remote;
              return { val: () => remote };
            },
          };
        },
      },
    },
    console,
    FUNCIONARIOS: employees,
    _cpfSoDigitos: value => String(value || '').replace(/\D/g, ''),
    _erpFuncionarioAtivo: employee => employee.status !== 'Inativo',
    _mesclarFuncEdit: data => data,
    esc: value => String(value ?? ''),
  };
  const api = vm.runInNewContext(code + `\n({
    setup() {
      _rhidPaginasPendentes = [{ nome: 'TESTE', cpf: '', dias: [1] }];
      _rhidVinculosPendentes = new Map([[0, 'F001']]);
      _rhidAssinaturaCadastro = _rhidAssinaturaFuncionarios();
    },
    refreshLocal() { _rhidAtualizarOpcoesFuncionarios(); },
    refreshRemote() { return atualizarFuncionariosPreviaRHiD(true); },
    link() { return _rhidVinculosPendentes.get(0); },
  })`, context);
  api.setup();
  return {
    api, employees, select, input, status,
    setRemote(data) { remote = data; },
    get reads() { return reads; },
  };
}

test('cadastro novo na mesma sessão atualiza opções sem refazer PDF e preserva vínculo anterior', () => {
  const f = fixture();
  f.employees.push({ mat: 'F002', nome: 'NOVO FUNCIONARIO', status: 'Ativo' });
  f.api.refreshLocal();
  assert.match(f.select.innerHTML, /NOVO FUNCIONARIO \(F002\)/);
  assert.match(f.select.innerHTML, /F001.*selected/);
  assert.equal(f.select.value, 'F001');
  assert.equal(f.api.link(), 'F001');
  assert.equal(f.input.value, 'FUNCIONARIO ANTIGO (F001)', 'busca própria mantém funcionário selecionado');
  assert.equal(f.reads, 0, 'sincronização local não provoca consultas ao banco');
});

test('cadastro novo na nuvem aparece com atualização sob demanda, sem alterar vínculos', async () => {
  const f = fixture();
  f.setRemote([
    { mat: 'F001', nome: 'FUNCIONARIO ANTIGO', status: 'Ativo' },
    { mat: 'F003', nome: 'CADASTRADO EM OUTRA ABA', status: 'Ativo' },
  ]);
  await f.api.refreshRemote();
  assert.match(f.select.innerHTML, /CADASTRADO EM OUTRA ABA \(F003\)/);
  assert.equal(f.api.link(), 'F001');
  assert.equal(f.reads, 1);
  assert.equal(f.status.textContent, 'Lista de funcionários atualizada.');
});

test('erro de permissão ao atualizar RH não apaga as opções locais', async () => {
  const f = fixture();
  f.setRemote(new Error('permission_denied'));
  await f.api.refreshRemote();
  assert.equal(f.api.link(), 'F001');
  assert.equal(f.employees.length, 1);
  assert.match(f.status.textContent, /Não foi possível consultar/);
});

import { loadFirebaseCompat } from './firebase-loader.js';
import { createSecureAuthClient } from './secure-auth-client.js';
import { createLegacyDatabaseAdapter } from './legacy-db-adapter.js';
import { createRealtimeBusinessRepository } from './realtime-business-repository.js';

function loadClassic(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.body.appendChild(script);
  });
}

function showFatal(error) {
  console.error(error);
  const login = document.getElementById('login-screen');
  if (login) login.style.display = 'flex';
  const err = document.getElementById('lerr');
  if (err) {
    err.style.display = 'block';
    err.textContent = 'Não foi possível inicializar o sistema. Verifique a configuração local/servidor.';
  }
}

function installRestUrl(runtimeConfig) {
  window.__firebaseRestUrl = (path, params = {}) => {
    const cleanPath = String(path || '').replace(/^\/+|\/+$/g, '');
    let base;
    const query = new URLSearchParams();
    if (runtimeConfig.emulators?.enabled) {
      const host = runtimeConfig.emulators.host || '127.0.0.1';
      base = `http://${host}:${runtimeConfig.emulators.databasePort || 9000}/${cleanPath}.json`;
      query.set('ns', runtimeConfig.firebase.projectId);
    } else {
      base = `${String(runtimeConfig.firebase.databaseURL || '').replace(/\/$/, '')}/${cleanPath}.json`;
    }
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const qs = query.toString();
    return qs ? `${base}?${qs}` : base;
  };
}


function setText(selector, value) {
  document.querySelectorAll(selector).forEach((el) => { el.textContent = value || ''; });
}

function applyPublicBranding(publicConfig) {

  const branding = publicConfig?.branding || {};
  const company = publicConfig?.company || {};
  document.querySelectorAll('[data-brand-logo]').forEach((el) => {
    const prefix = branding.logoPrefix || '';
    const accent = branding.logoAccent || '';
    el.textContent = '';
    el.append(document.createTextNode(prefix));
    const span = document.createElement('span'); span.textContent = accent; el.appendChild(span);
  });
  setText('[data-brand-tagline]', branding.tagline);
  setText('[data-brand-cnpj]', company.cnpj);
  setText('[data-brand-ie]', company.ie);
  setText('[data-brand-address]', company.endereco);
  setText('[data-brand-legal-name]', company.razaoSocial || company.nome);
  setText('[data-brand-name]', company.nome || company.key);
  setText('[data-brand-responsavel]', company.responsavel);
  setText('[data-brand-financeiro]', company.financeiro);
  setText('[data-brand-escritorio]', company.escritorio);
  setText('[data-brand-compras]', company.compras);
  setText('[data-brand-email]', company.email);
  const contacts = [
    company.financeiro ? `Financeiro: ${company.financeiro}` : '',
    company.escritorio ? `Escritório: ${company.escritorio}` : '',
    company.compras ? `Compras: ${company.compras}` : '',
  ].filter(Boolean).join(' · ');
  setText('[data-brand-address-contacts]', [company.enderecoCurto || company.endereco || '', contacts ? `📞 ${contacts}` : ''].filter(Boolean).join(' · '));
  if (branding.title) document.title = branding.title;
  window.__PUBLIC_BUSINESS_CONFIG__ = publicConfig || {};
}

window.__applyPublicBranding = applyPublicBranding;

function arquivarCachesAntigosAntesDaNuvem(){
  const keys=['mm_bancos','mm_bancos_deletados','mm_lanc_banco','mm_cr','mm_adt_cli','mm_cheques_cli','mm_fc_lanc','mm_fc_saldoini'];
  for(const key of keys){
    try{
      const raw=localStorage.getItem(key);
      if(!raw) continue;
      const parsed=JSON.parse(raw);
      if(parsed && typeof parsed==='object' && Object.keys(parsed).length>0){
        const archive=`${key}_backup_pre_cloud_v28`;
        if(!localStorage.getItem(archive)) localStorage.setItem(archive,raw);
      }
    }catch(error){console.warn('Arquivo do cache legado indisponível:',key,error);}
  }
}

async function main() {
  arquivarCachesAntigosAntesDaNuvem();
  const configResponse = await fetch('/api/config', { credentials: 'same-origin' });
  if (!configResponse.ok) throw new Error(`Config endpoint retornou ${configResponse.status}`);
  const runtimeConfig = await configResponse.json();
  window.__APP_CONFIG__ = runtimeConfig;

  const publicResponse = await fetch('/api/public-config', { credentials: 'same-origin' });
  if (publicResponse.ok) applyPublicBranding(await publicResponse.json());
  installRestUrl(runtimeConfig);

  const { auth, db, storage } = await loadFirebaseCompat(runtimeConfig);
  window.secureAuth = createSecureAuthClient(auth);
  window.__legacyDbAdapter = (rawDb) => createLegacyDatabaseAdapter(rawDb, storage);
  window.__fbRaw = { auth, db, storage };
  window.__businessRepository = createRealtimeBusinessRepository(db);

  await loadClassic('/legacy/audit-trail.js');
  await loadClassic('/legacy/firebase-sync.js');
  await loadClassic('/legacy/app-core.js');
  await loadClassic('/legacy/module-access-guard.js');
  await loadClassic('/legacy/app-agenda.js');
  await loadClassic('/legacy/app-avisos.js');
  await loadClassic('/legacy/security-overrides.js');
  await loadClassic('/legacy/supplier-compat.js');
  await loadClassic('/legacy/alert-state-sync.js');
  await loadClassic('/legacy/chat-read-sync.js');
  await loadClassic('/legacy/access-dependencies.js');

  document.dispatchEvent(new CustomEvent('erp:ready'));
}

main().catch(showFatal);

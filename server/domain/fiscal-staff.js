export function fiscalStaffPublicView(raw) {
  const items = Array.isArray(raw) ? raw : Object.values(raw || {});
  if (items.length > 5000) throw Object.assign(new Error('Cadastro de funcionários excede o limite de consulta.'), { status: 413 });
  return items.filter(f => f && typeof f === 'object').map(f => ({
    mat: String(f.mat || '').slice(0, 40),
    nome: String(f.nome || '').slice(0, 150),
    sal: Number.isFinite(Number(f.sal)) && Number(f.sal) >= 0 && Number(f.sal) < 1e9 ? Number(f.sal) : 0,
  })).filter(f => f.mat && f.nome).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

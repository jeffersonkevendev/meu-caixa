const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const objeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const porId = (v) => Array.isArray(v) && v.every((r) => objeto(r) && typeof r.id === 'string') && new Set(v.map((r) => r.id)).size === v.length;
export function mesclarDados(base, local, remoto) {
  if (igual(local, base)) return remoto;
  if (igual(remoto, base) || igual(local, remoto)) return local;
  if (objeto(base) && objeto(local) && objeto(remoto)) {
    const saida = {};
    for (const chave of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remoto)])) {
      const valor = mesclarDados(base[chave], local[chave], remoto[chave]);
      if (valor !== undefined) saida[chave] = valor;
    }
    return saida;
  }
  if (porId(base) && porId(local) && porId(remoto)) {
    const mapa = (lista) => Object.fromEntries(lista.map((r) => [r.id, r]));
    const unidos = mesclarDados(mapa(base), mapa(local), mapa(remoto));
    const ordem = [...new Set([...remoto, ...local].map((r) => r.id))];
    return ordem.filter((id) => unidos[id] !== undefined).map((id) => unidos[id]);
  }
  const erro = new Error('Este registro também foi alterado na outra conta. Exporte suas alterações pendentes e recarregue para conferir antes de editar novamente.');
  erro.code = 'conflito-compartilhado';
  throw erro;
}

export function mensagemErroNuvem(erro) {
  const codigo = (erro?.code || "").replace(/^firestore\//, "");
  const mensagens = {
    "conflito-compartilhado": "Este registro também foi alterado na outra conta. Use Exportar alterações pendentes e recarregue para conferir antes de editar novamente.",
    "permission-denied": "O Firebase recusou o acesso aos seus dados. Confira as regras do Firestore para sua conta.",
    unauthenticated: "Sua sessão precisa ser renovada. Entre novamente na sua conta.",
    unavailable: "Não foi possível conectar ao Firebase. Verifique sua internet e tente novamente.",
    "deadline-exceeded": "O Firebase demorou para responder. Verifique sua internet e tente novamente.",
    "resource-exhausted": "O limite de uso do Firebase foi atingido. Tente novamente mais tarde.",
  };
  return mensagens[codigo] || `Não foi possível sincronizar com o Firebase${codigo ? ` (${codigo})` : ""}. Tente novamente.`;
}

// Adaptador independente de React para testar leituras e escritas sem dados reais.
export function criarSincronizacaoNuvem({ padrao, escutar, gravar, notificar, tempoLeitura = 15000 }) {
  let ativo = true;
  let confirmado = { ...padrao };
  let pendentes = {};
  let revisao = 0;
  let gravando = false;
  let carregado = false;
  let erroLeitura = null;
  let erroSalvar = null;
  let cancelar = () => {};
  let timer;
  let geracao = 0;

  const emitir = () => {
    if (!ativo) return;
    const alteracoes = Object.fromEntries(Object.entries(pendentes).map(([campo, item]) => [campo, item.valor]));
    notificar({
      dados: { ...confirmado, ...alteracoes },
      carregando: !carregado && !erroLeitura,
      salvando: gravando,
      temPendencias: Object.keys(pendentes).length > 0,
      erroLeitura: erroLeitura ? mensagemErroNuvem(erroLeitura) : "",
      erroSalvar: erroSalvar ? mensagemErroNuvem(erroSalvar) : "",
    });
  };

  async function salvar() {
    if (!ativo || !carregado || erroLeitura || erroSalvar || gravando || !Object.keys(pendentes).length) return;
    gravando = true;
    emitir();
    try {
      while (ativo && !erroLeitura && Object.keys(pendentes).length) {
        const lote = { ...pendentes };
        const patch = Object.fromEntries(Object.entries(lote).map(([campo, item]) => [campo, item.valor]));
        const bases = Object.fromEntries(Object.entries(lote).map(([campo, item]) => [campo, item.base]));
        const gravado = await gravar(patch, bases);
        if (!ativo) return;
        confirmado = { ...confirmado, ...(gravado && typeof gravado === "object" && !Array.isArray(gravado) ? gravado : patch) };
        for (const [campo, item] of Object.entries(lote)) {
          if (pendentes[campo]?.revisao === item.revisao) delete pendentes[campo];
          else if (pendentes[campo]) pendentes[campo].base = item.valor;
        }
      }
    } catch (erro) {
      if (ativo) erroSalvar = erro;
    } finally {
      gravando = false;
      emitir();
    }
  }

  function iniciarLeitura() {
    cancelar();
    clearTimeout(timer);
    const atual = ++geracao;
    erroLeitura = null;
    carregado = false;
    emitir();
    const falhou = (erro) => {
      if (!ativo || atual !== geracao) return;
      clearTimeout(timer);
      erroLeitura = erro;
      emitir();
    };
    timer = setTimeout(() => falhou({ code: "unavailable" }), tempoLeitura);
    try {
      cancelar = escutar((snap) => {
        if (!ativo || atual !== geracao || snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        clearTimeout(timer);
        confirmado = { ...padrao, ...(snap.exists() ? snap.data() : {}) };
        carregado = true;
        erroLeitura = null;
        emitir();
        void salvar();
      }, falhou);
    } catch (erro) {
      falhou(erro);
    }
  }

  return {
    iniciar: iniciarLeitura,
    alterar(campo, valorOuFuncao) {
      if (!ativo || !carregado || erroLeitura || erroSalvar) return;
      const anterior = pendentes[campo] ? pendentes[campo].valor : confirmado[campo];
      const valor = typeof valorOuFuncao === "function" ? valorOuFuncao(anterior) : valorOuFuncao;
      pendentes[campo] = { valor, base: pendentes[campo] ? pendentes[campo].base : confirmado[campo], revisao: ++revisao };
      emitir();
      void salvar();
    },
    tentarNovamente() {
      if (!ativo) return;
      erroSalvar = null;
      if (erroLeitura) iniciarLeitura();
      else {
        emitir();
        void salvar();
      }
    },
    parar() {
      ativo = false;
      ++geracao;
      cancelar();
      clearTimeout(timer);
    },
  };
}

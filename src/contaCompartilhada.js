import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, setDoc, runTransaction, deleteField } from 'firebase/firestore';
import { db } from './firebase';
const perfil = (u) => ({ uid: u.uid, nome: u.displayName || u.email || 'Usuário', email: u.email || '', foto: u.photoURL || '' });
const referencia = (uid) => doc(db, 'usuarios', uid, 'compartilhamento', 'config');
export function useContaCompartilhada(usuario) {
  const [preferencia, setPreferencia] = useState(undefined), [config, setConfig] = useState(null), [convites, setConvites] = useState([]), [enviados, setEnviados] = useState([]), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false), [configPronta, setConfigPronta] = useState(false);
  const uidDono = preferencia || usuario.uid;
  useEffect(() => onSnapshot(doc(db, 'preferenciasCompartilhamento', usuario.uid), (s) => { setPreferencia(s.data()?.donoUid || usuario.uid); }, () => { setPreferencia(usuario.uid); setErro('Não foi possível carregar o compartilhamento. Confira se as novas regras foram publicadas.'); }), [usuario.uid]);
  useEffect(() => {
    if (preferencia === undefined) return;
    setConfigPronta(false); setConfig(null);
    return onSnapshot(referencia(uidDono), (s) => { setConfig(s.data() || null); setConfigPronta(true); }, () => {
      setConfigPronta(true); setConfig(null);
      if (uidDono !== usuario.uid) { setErro('O compartilhamento foi encerrado. Você voltou aos seus dados pessoais.'); setPreferencia(usuario.uid); void setDoc(doc(db, 'preferenciasCompartilhamento', usuario.uid), { donoUid: usuario.uid }); }
      else setErro('Publique as regras de compartilhamento no Firebase para ativar esta função.');
    });
  }, [uidDono, preferencia === undefined, usuario.uid]);
  useEffect(() => {
    if (!usuario.emailVerified || !usuario.email) return;
    const a = onSnapshot(query(collection(db, 'convitesCompartilhamento'), where('email', '==', usuario.email), where('status', '==', 'pendente')), (s) => setConvites(s.docs.map((d) => ({ ...d.data(), id: d.id }))), () => setErro('Não foi possível consultar os convites. Confira as regras de compartilhamento.'));
    const b = onSnapshot(query(collection(db, 'convitesCompartilhamento'), where('donoUid', '==', usuario.uid), where('status', '==', 'pendente')), (s) => setEnviados(s.docs.map((d) => ({ ...d.data(), id: d.id }))), () => {});
    return () => { a(); b(); };
  }, [usuario.uid, usuario.email, usuario.emailVerified]);
  const executar = async (acao) => { setOcupado(true); setErro(''); try { await acao(); } catch (e) { setErro(e.message || 'Não foi possível concluir. Tente novamente.'); } finally { setOcupado(false); } };
  return { uidDono, config, convites, enviados, erro, ocupado, pronto: preferencia !== undefined && configPronta,
    membros: config ? [config.dono, config.parceiro].filter(Boolean) : [perfil(usuario)],
    convidar: (email) => executar(async () => {
      email = email.trim();
      if (!usuario.emailVerified) throw new Error('Entre novamente com uma conta Google com e-mail verificado.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.toLowerCase() === usuario.email?.toLowerCase()) throw new Error('Informe o e-mail Google da outra pessoa.');
      if (uidDono !== usuario.uid) throw new Error('Somente o responsável pode convidar.');
      await runTransaction(db, async (t) => {
        const ref = referencia(usuario.uid), s = await t.get(ref);
        if (s.data()?.parceiro) throw new Error('Este espaço já possui outra pessoa. Remova o acesso atual antes de convidar.');
        t.set(ref, { dono: perfil(usuario) }, { merge: true });
        const convite = doc(collection(db, 'convitesCompartilhamento'));
        t.set(convite, { donoUid: usuario.uid, dono: perfil(usuario), email, status: 'pendente', criadoEm: Date.now() });
      });
    }),
    aceitar: (convite) => executar(async () => {
      await runTransaction(db, async (t) => {
        const ir = doc(db, 'convitesCompartilhamento', convite.id), cs = await t.get(ir);
        if (!cs.exists() || cs.data().status !== 'pendente' || cs.data().email !== usuario.email) throw new Error('Este convite não está mais disponível.');
        const cr = referencia(convite.donoUid);
        t.update(ir, { status: 'aceito', aceitoUid: usuario.uid });
        t.update(cr, { parceiro: perfil(usuario), conviteId: convite.id });
        t.set(doc(db, 'preferenciasCompartilhamento', usuario.uid), { donoUid: convite.donoUid });
      });
      setPreferencia(convite.donoUid);
    }),
    cancelar: (id) => executar(() => setDoc(doc(db, 'convitesCompartilhamento', id), { status: 'cancelado' }, { merge: true })),
    encerrar: () => executar(async () => {
      await runTransaction(db, async (t) => { const r = referencia(uidDono), s = await t.get(r); if (!s.exists()) return; t.update(r, { parceiro: deleteField(), conviteId: deleteField() }); });
      if (uidDono !== usuario.uid) { await setDoc(doc(db, 'preferenciasCompartilhamento', usuario.uid), { donoUid: usuario.uid }); setPreferencia(usuario.uid); }
    }),
  };
}

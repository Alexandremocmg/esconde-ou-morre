import { createClient } from '@supabase/supabase-js';

// Conta de jogador (Plano 2, Fase A — docs/PLANO_CONTAS.md). Backend é o
// Supabase (Auth + Postgres) — projeto "esconde-ou-morre" criado à parte,
// nada disto reaproveita o servidor Node/ws de `server/` (esse continua só
// cuidando do estado EFÊMERO da partida Online, ver docs/PLANO_MULTIPLAYER.md).
//
// A publishable key abaixo é segura de expor no cliente por design (é o
// equivalente do "anon key" do Supabase) — a segurança de verdade vem das
// políticas RLS no banco (ver migration `contas_fundacao`), não do sigilo
// desta chave.
const SUPABASE_URL = 'https://nqcjlnqutujxyctkglkh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_HsjE4Ict-sjiolNOHHQhOA_R-lSckh2';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Cria a conta. O trigger `handle_new_user` (banco) já cria a linha em
// `profiles` sozinho — se `username` vier preenchido, grava em
// `raw_user_meta_data` pro trigger usar; senão o trigger cai pro prefixo do
// e-mail. Não precisa (nem deve) inserir em `profiles` daqui — corrida com o
// trigger seria redundante e a RLS de insert já exige `auth.uid() = id`, que
// só existe DEPOIS que a conta é criada.
export async function signUp(email, password, username) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: username ? { data: { username } } : undefined,
  });
  return { data, error };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

// Sessão já persiste sozinha (localStorage interno do SDK do Supabase) —
// sobrevive a reload E a trocar de aba, diferente do sessionStorage que
// Net.js usa pra sessão de partida (esse continua por-aba, de propósito).
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  return { session: data?.session ?? null, error };
}

// `callback(session)` roda no login/logout/refresh de token. Devolve a
// função de unsubscribe (padrão do SDK) — quem chamar guarda e desliga se
// precisar (ex.: MenuUI recriado num restart de partida).
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function getProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return { profile: data, error };
}

export async function updateProfile(userId, fields) {
  const { data, error } = await supabase.from('profiles').update(fields).eq('id', userId).select().single();
  return { profile: data, error };
}

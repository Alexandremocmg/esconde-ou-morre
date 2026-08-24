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

// Ranking (Plano 2, Fase E — docs/PLANO_CONTAS.md). Client-reported: só
// grava se houver sessão (sem conta, sem ranking — silencioso, não é erro).
// Decisão registrada em PLANO_CONTAS.md: um jogador só pode mentir sobre o
// PRÓPRIO resultado (não dá pra creditar/incriminar a conta de outra pessoa
// sem roubar a sessão dela) — mesmo nível de confiança de qualquer stat
// client-reported, `verified` fica sempre `false` por enquanto (coluna já
// existe pensando numa Fase futura server-authoritative pro modo Online).
export async function reportMatchResult({ mode, won, camoTimeSeconds = 0 }) {
  const { session } = await getSession();
  if (!session) return;
  const { error } = await supabase.from('match_results').insert({
    user_id: session.user.id,
    mode,
    won: !!won,
    camo_time_seconds: Math.max(0, Math.round(camoTimeSeconds)),
  });
  // Falha aqui (rede, RLS etc.) não deve travar o fim de partida do jogador
  // — só perde a entrada no ranking dessa partida específica.
  if (error) console.warn('[ranking] falha ao gravar resultado:', error.message);
}

// Junta `username` nas linhas de `match_results` (sem FK direta pra
// `profiles` — as duas tabelas referenciam `auth.users` separadamente, não
// uma à outra — então o embed automático do PostgREST não funciona aqui;
// 2 queries simples resolve pra um top 10-20, sem precisar de view nova).
async function attachUsernames(rows) {
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (!ids.length) return [];
  const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', ids);
  const nameById = new Map((profiles || []).map((p) => [p.id, p.username]));
  return rows.map((r) => ({ ...r, username: nameById.get(r.user_id) || 'Jogador' }));
}

// Top sobrevivência (Camaleão, solo + Online juntos — "por modo" do plano
// vira "por papel": a melhor partida de um jogador conta, seja treino
// sozinho ou partida online de verdade).
export async function getSurvivalRanking(limit = 10) {
  const { data: rows, error } = await supabase
    .from('match_results')
    .select('user_id, camo_time_seconds, played_at')
    .in('mode', ['chameleon', 'online_chameleon'])
    .order('camo_time_seconds', { ascending: false })
    .limit(limit);
  if (error || !rows) return [];
  return attachUsernames(rows);
}

// Top Caçador por número de vitórias. Supabase JS não faz GROUP BY sem
// RPC/view — pra um ranking casual, agrega no cliente sobre as últimas 500
// partidas vencidas (suficiente pro volume de um joguinho; documentado como
// limitação conhecida em docs/PLANO_CONTAS.md).
export async function getHunterRanking(limit = 10) {
  const { data: rows, error } = await supabase
    .from('match_results')
    .select('user_id')
    .in('mode', ['hunter', 'online_hunter'])
    .eq('won', true)
    .limit(500);
  if (error || !rows) return [];
  const wins = new Map();
  for (const r of rows) wins.set(r.user_id, (wins.get(r.user_id) || 0) + 1);
  const top = [...wins.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([user_id, winsCount]) => ({ user_id, wins: winsCount }));
  return attachUsernames(top);
}

// Missões (Plano 2, Fase F). `code` identifica a missão (ver migration
// `seed_missions`) — client-reported, mesma ressalva de confiabilidade da
// Fase E (§4 de docs/PLANO_CONTAS.md): quem chama decide SE marcar
// progresso, não dá pra fingir progresso de outra conta sem roubar a sessão
// dela. Lê o progresso atual antes de somar (em vez de incrementar às
// cegas) pra nunca passar de `goal_count` nem reabrir uma missão já
// completada — sem RPC/transação, é o melhor que dá pra garantir num
// upsert simples; corrida entre duas abas do mesmo jogador no MESMO
// instante é o único jeito de perder uma atualização, tolerável pra
// missões cosméticas.
export async function bumpMissionProgress(code, amount = 1) {
  const { session } = await getSession();
  if (!session) return;
  const { data: mission } = await supabase.from('missions').select('id, goal_count').eq('code', code).single();
  if (!mission) return;
  const { data: existing } = await supabase
    .from('mission_progress')
    .select('progress, completed_at')
    .eq('user_id', session.user.id)
    .eq('mission_id', mission.id)
    .maybeSingle();
  if (existing?.completed_at) return; // já completa, nada a fazer
  const next = Math.min(mission.goal_count, (existing?.progress || 0) + amount);
  const { error } = await supabase.from('mission_progress').upsert({
    user_id: session.user.id,
    mission_id: mission.id,
    progress: next,
    completed_at: next >= mission.goal_count ? new Date().toISOString() : null,
  });
  if (error) console.warn('[missoes] falha ao atualizar progresso:', error.message);
}

// Todas as missões + progresso do jogador logado (0 se nunca começou
// nenhuma). Sem conta, devolve as missões com progresso zerado — a tela de
// Missões mostra a lista mesmo deslogado, só não acompanha nada ainda.
export async function getMissionsWithProgress() {
  const { data: missions } = await supabase.from('missions').select('*').order('code');
  if (!missions) return [];
  const { session } = await getSession();
  if (!session) return missions.map((m) => ({ ...m, progress: 0, completed: false }));
  const { data: progress } = await supabase
    .from('mission_progress')
    .select('mission_id, progress, completed_at')
    .eq('user_id', session.user.id);
  const byMissionId = new Map((progress || []).map((p) => [p.mission_id, p]));
  return missions.map((m) => {
    const p = byMissionId.get(m.id);
    return { ...m, progress: p ? p.progress : 0, completed: !!(p && p.completed_at) };
  });
}

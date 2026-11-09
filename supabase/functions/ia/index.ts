// Anamnesia — IA (Claude) dentro do prontuário (Supabase Edge Function "ia").
//
// Pedido do autor (09/11/2026): atualizar o contexto, melhorar a escrita da evolução e sugerir condutas
// com referências. Uso restrito: só as contas cujo e-mail está no segredo ANAMNESIA_IA_EMAILS
// (separados por vírgula). A chave da API fica no segredo ANTHROPIC_API_KEY, nunca no site.
//
// Modelos (escolha do autor; revisão de 09/11/2026: contexto e condutas passaram para o Sonnet):
//   contexto   → Claude Sonnet 5.5 (interpretar a evolução e a avaliação para atualizar o contexto)
//   escrita    → Claude Sonnet 5.5 (revisar a escrita da evolução do dia, sem mudar o conteúdo)
//   condutas   → Claude Sonnet 5.5 (recomendações com busca em PubMed, Cochrane e diretrizes AHA/ESC/KDIGO)
//   pendencias → Claude Haiku 5.5  (na troca de plantão: condutas de plantões anteriores sem registro no prontuário)
//
// O site envia o prontuário já sem nome (pseudonimizado no aparelho). Nada é gravado aqui.
// Corpo: { tarefa: "ping" | "contexto" | "escrita" | "condutas" | "pendencias", texto?: string }
// Resposta: { ok, permitido?, texto?, fontes?, uso?: { modelo, entrada, saida, buscas, custo_usd } }

import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";

const ORIGENS = ["https://anamnesia.net.br", "https://www.anamnesia.net.br", "null", "http://localhost", "http://127.0.0.1"];
const MAX_TEXTO = 120_000;   // caracteres; um prontuário longo tem ~30 mil

// preços por milhão de tokens (tabela da API em 10/2026) e da busca na web (estimativa: US$ 10 por mil buscas)
const PRECO: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.10, 0.50],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
const PRECO_BUSCA = 0.01;

// domínios que a busca pode consultar (o autor pediu PubMed, Cochrane e diretrizes AHA, ESC e KDIGO)
const DOMINIOS = ["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "cochranelibrary.com", "ahajournals.org",
  "escardio.org", "academic.oup.com", "kdigo.org"];

const BASE = "Você ajuda um médico residente de terapia intensiva e clínica médica no Brasil. " +
  "O prontuário vem sem identificação do paciente. Responda sempre em português do Brasil. " +
  "Use somente o que está escrito no prontuário: não invente dados, valores, datas nem exames.";

type Tarefa = {
  modelo: string;
  effort: "low" | "medium" | "high";
  system: string;
  busca?: boolean;
  fallback: boolean;   // rota de reserva do servidor em caso de recusa (Sonnet 5.5 e Opus 5.5)
};
const TAREFAS: Record<string, Tarefa> = {
  contexto: {
    modelo: "claude-sonnet-5-5", effort: "medium", fallback: true,
    system: BASE + " Tarefa: atualizar o campo \"Contexto\", que resume a internação. Leia o contexto atual, a evolução " +
      "da internação (ou a evolução diária) e os dados da avaliação (sinais vitais, balanço hídrico, dispositivos, infusões, " +
      "suporte ventilatório, antimicrobianos e exames) e reescreva o contexto interpretando o que mudou no quadro. " +
      "Não copie as evoluções nem liste os dados brutos do dia: sintetize, em ordem cronológica, os fatos relevantes da " +
      "internação (motivo da admissão, diagnósticos, procedimentos, intercorrências e resposta ao tratamento) e a tendência " +
      "clínica atual. Mantenha do contexto atual o que continua relevante. A interpretação deve se apoiar só no que está " +
      "escrito: não acrescente diagnósticos, valores nem fatos que não estejam no prontuário e não sugira condutas. " +
      "Texto corrido, objetivo, com no máximo 200 palavras. Responda apenas com o novo texto do contexto, sem título nem comentários.",
  },
  escrita: {
    modelo: "claude-sonnet-5-5", effort: "medium", fallback: true,
    system: BASE + " Tarefa: revisar a escrita da evolução do dia que vem marcada como TEXTO A REVISAR: corrigir ortografia, " +
      "concordância e pontuação, deixar as frases claras e objetivas e usar a terminologia médica usual. " +
      "Não acrescente nem retire nenhuma informação clínica, não mude valores, doses, datas nem a ordem dos fatos. " +
      "O restante do prontuário serve só de contexto. Responda apenas com o texto revisado, sem comentários.",
  },
  condutas: {
    modelo: "claude-sonnet-5-5", effort: "medium", busca: true, fallback: true,
    system: BASE + " Tarefa: propor recomendações de conduta para discussão com o preceptor, organizadas por problema ativo do prontuário. " +
      "Busque as referências em PubMed, Cochrane e nas diretrizes da AHA, ESC e KDIGO com a ferramenta de busca; " +
      "cite só o que encontrou nas buscas, com o link, e diga quando a evidência é fraca ou quando não achou referência. Seja conciso. " +
      "Formato obrigatório, em texto simples, sem tabelas, negrito nem outros marcadores: para cada problema, uma linha " +
      "\"## <problema>\"; abaixo, uma linha por recomendação, exatamente assim: " +
      "\"- <conduta, em uma frase> | Racional: <uma ou duas frases> | Referência: <autor ou sociedade, ano, título curto> <link>\" " +
      "(sem referência encontrada: \"Referência: não encontrada nas buscas\"; evidência fraca: acrescente \"(evidência fraca)\" ao racional); " +
      "e, quando faltar no prontuário um dado necessário para decidir, uma linha \"Falta: <dado>\". " +
      "Termine com a frase: \"Sugestões para discussão; a decisão é da equipe assistente.\"",
  },
  pendencias: {
    modelo: "claude-haiku-5-5", effort: "low", fallback: false,
    system: BASE + " Tarefa: conferir as condutas registradas em plantões anteriores (lista CONDUTAS A CONFERIR) contra o restante do prontuário. " +
      "Para cada conduta que gera algo que deveria aparecer registrado no prontuário (resultado ou laudo de exame solicitado, cultura, " +
      "parecer, procedimento, troca ou retirada de dispositivo) e que ainda não aparece registrado, escreva uma pendência curta e objetiva " +
      "(exemplo: conduta \"Solicito ecocardiograma transtorácico\" sem laudo nos exames de imagem → \"Laudo do ecocardiograma transtorácico\"). " +
      "Não crie pendência para conduta que já aparece realizada ou com resultado no prontuário, nem para o que já está em PENDÊNCIAS ATUAIS, " +
      "mesmo com outras palavras, nem para nada que não decorra das condutas listadas. " +
      "Responda só com as pendências, uma por linha começando com \"- \", ou apenas com a palavra NENHUMA.",
  },
};

class ErroIA extends Error {
  constructor(msg: string, public status = 400, public codigo = "IA") { super(msg); }
}

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  const ok = ORIGENS.some((x) => o === x || (x.startsWith("http://") && o.startsWith(x + ":")));
  return {
    "Access-Control-Allow-Origin": ok ? o : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" } });

// confere o login no Supabase e devolve o e-mail da conta
async function emailDoUsuario(req: Request): Promise<string> {
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) throw new ErroIA("Entre na sua conta do Anamnesia.", 401, "LOGIN");
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) throw new ErroIA("SUPABASE_URL ausente na função.", 500, "CONFIG");
  const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey, Authorization: auth }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new ErroIA("Sessão expirada: entre de novo na sua conta.", 401, "LOGIN");
  const u = await r.json().catch(() => ({}));
  return String(u?.email ?? "").trim().toLowerCase();
}
function permitido(email: string): boolean {
  const lista = (Deno.env.get("ANAMNESIA_IA_EMAILS") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !!email && lista.includes(email);
}

function custo(modelo: string, entrada: number, saida: number, buscas: number): number {
  const [pi, po] = PRECO[modelo] ?? [0, 0];
  return Math.round(((entrada * pi + saida * po) / 1e6 + buscas * PRECO_BUSCA) * 10000) / 10000;
}

async function executar(tarefa: Tarefa, texto: string) {
  const client = new Anthropic({ timeout: 140_000, maxRetries: 1 });   // ANTHROPIC_API_KEY (e ANTHROPIC_BASE_URL nos testes)
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: texto }];
  const params: Record<string, unknown> = {
    model: tarefa.modelo,
    max_tokens: tarefa.busca ? 16000 : 8000,
    system: tarefa.system,
    thinking: { type: "adaptive" },
    output_config: { effort: tarefa.effort },
  };
  if (tarefa.busca) params.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 4, allowed_domains: DOMINIOS }];
  if (tarefa.fallback){ params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }

  let entrada = 0, saida = 0, buscas = 0, modeloUsado = tarefa.modelo;
  const textos: string[] = [];
  const fontes = new Map<string, string>();
  // a busca roda no servidor da Anthropic; uma resposta longa pode vir em partes (pause_turn)
  for (let volta = 0; volta < 3; volta++){
    // deno-lint-ignore no-explicit-any
    const r: any = await client.beta.messages.create({ ...params, messages } as any);
    modeloUsado = r.model ?? modeloUsado;
    entrada += (r.usage?.input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0);
    saida += r.usage?.output_tokens ?? 0;
    buscas += r.usage?.server_tool_use?.web_search_requests ?? 0;
    if (r.stop_reason === "refusal") throw new ErroIA("O modelo recusou este pedido. Revise o texto enviado ou tente de novo.", 422, "RECUSA");
    for (const b of r.content ?? []){
      if (b.type === "text"){
        textos.push(b.text);
        for (const c of b.citations ?? []) if (c.url) fontes.set(c.url, c.title ?? c.url);
      }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content))
        for (const w of b.content) if (w.url && !fontes.has(w.url)) fontes.set(w.url, w.title ?? w.url);
    }
    if (r.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: r.content });
  }
  const final = textos.join("").trim();
  if (!final) throw new ErroIA("A IA não devolveu texto. Tente de novo.", 502, "VAZIO");
  return {
    texto: final,
    fontes: [...fontes].map(([url, titulo]) => ({ url, titulo })).slice(0, 20),
    uso: { modelo: modeloUsado, entrada, saida, buscas, custo_usd: custo(modeloUsado in PRECO ? modeloUsado : tarefa.modelo, entrada, saida, buscas) },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, erro: "Use POST." });
  try {
    const email = await emailDoUsuario(req);
    const corpo = await req.json().catch(() => ({}));
    const nome = String(corpo?.tarefa ?? "");
    if (nome === "ping") return json(req, 200, { ok: true, permitido: permitido(email) });
    if (!permitido(email)) throw new ErroIA("A IA do Anamnesia não está liberada para esta conta.", 403, "NEGADO");
    const tarefa = TAREFAS[nome];
    if (!tarefa) throw new ErroIA("Tarefa desconhecida.", 400, "TAREFA");
    const texto = String(corpo?.texto ?? "").trim();
    if (!texto) throw new ErroIA("Prontuário vazio.", 400, "VAZIO");
    if (texto.length > MAX_TEXTO) throw new ErroIA("Prontuário longo demais para um pedido.", 413, "GRANDE");
    if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new ErroIA("A chave da API (ANTHROPIC_API_KEY) não foi cadastrada no Supabase.", 500, "CONFIG");
    return json(req, 200, { ok: true, ...(await executar(tarefa, texto)) });
  } catch (e) {
    if (e instanceof ErroIA) return json(req, e.status, { ok: false, erro: e.message, codigo: e.codigo });
    if (e instanceof Anthropic.AuthenticationError) return json(req, 500, { ok: false, erro: "A chave da API foi recusada pela Anthropic. Confira o segredo ANTHROPIC_API_KEY.", codigo: "CHAVE" });
    if (e instanceof Anthropic.RateLimitError) return json(req, 429, { ok: false, erro: "Limite da API atingido. Tente de novo em alguns minutos.", codigo: "LIMITE" });
    if (e instanceof Anthropic.BadRequestError) return json(req, 400, { ok: false, erro: "A API recusou o pedido: " + e.message, codigo: "API" });
    if (e instanceof Anthropic.APIError) return json(req, 502, { ok: false, erro: `Erro da API (${e.status ?? "?"}). Tente de novo.`, codigo: "API" });
    return json(req, 500, { ok: false, erro: "Erro inesperado na função ia.", codigo: "ERRO" });
  }
});

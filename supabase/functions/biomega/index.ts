// Anamnesia — extração de exames do portal Biomega/Lisnet (Supabase Edge Function).
//
// Porte de portal.py (app Flask do autor) sem Selenium: o login é um POST AJAX comum.
// Ações (campo "acao" do corpo JSON):
//   "login"      → só testa o login; devolve as unidades do portal.
//   "pedidos"    → lista os pedidos do prontuário no período (janelas de até 90 dias).
//   "resultados" → busca os resultados de até 10 pedidos (o app chama em lotes).
// - Exige usuário logado no Anamnesia (token do Supabase); sem isso, recusa.
// - Usuário e senha do portal chegam só na requisição: não são gravados nem logados.
// - Cada chamada faz o próprio login e não guarda nada entre chamadas.
// - Nunca devolve cookies, o token ztmAcaoTks nem o HTML do portal.

const PORTAL = (Deno.env.get("BIOMEGA_BASE") ?? "https://biomega.lisnet.com.br").replace(/\/+$/, "");
const URL_LOGIN = PORTAL + "/laudos/";
const URL_CONSULTAS = PORTAL + "/laudos/consultas/";
const URL_DADOS = URL_CONSULTAS + "z_selects.php";
const JANELA_MAX_DIAS = 90;       // limite da tela do portal
const PEDIDOS_POR_PAGINA = 23;    // rowNum do grid de pedidos
const MAX_PEDIDOS_POR_LOTE = 10;
const MAX_DIAS = 3650;

const ORIGENS = ["https://anamnesia.net.br", "https://www.anamnesia.net.br", "null", "http://localhost", "http://127.0.0.1"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Ordem das células em rows[].cell (colModel sem a coluna de checkbox "cb").
const COLUNAS_PEDIDO = ["VistoWeb", "Solicita", "Nome", "Idade", "Sexo", "Entrada", "Entrega", "Recebido",
  "Liberado", "Setormic", "Status", "Flags", "InfoPac", "InfoPdf", "Urgente", "InfoUrl",
  "Parcial", "Unidade", "Nascimento", "Prontuario", "SexoDesc"];
const COLUNAS_RESULTADO = ["Parametro", "Result", "Calcu", "Unidmed", "Flegui", "Omite", "CalcCod", "TroxeMat", "TemObs"];

const ERROS_LOGIN: Record<string, string> = {
  LoginSenhaErro: "Usuário ou senha incorretos.",
  SenhaErro: "Senha incorreta.",
  LoginInativo: "Usuário inativo no portal.",
  AcessoNegado: "Acesso negado pelo portal.",
  AcessoIpNegado: "O portal recusou o IP do servidor (bloqueio por IP).",
  AcessoBloqueado: "Acesso bloqueado pelo portal.",
  AcessoExpiradoLis: "Acesso expirado no portal.",
  AcessoExpirado: "Acesso expirado no portal.",
  PADRAO: "O portal pediu troca de senha ou outra ação (PADRAO).",
  VALIDACAO: "O portal pediu validação adicional (VALIDACAO).",
};

class ErroPortal extends Error {
  constructor(msg: string, public codigo = "PORTAL", public detalhe?: string) { super(msg); }
}

/* ---------------- utilitários ---------------- */
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

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°", ordm: "º", ordf: "ª", micro: "µ", sup2: "²", sup3: "³",
  aacute: "á", Aacute: "Á", agrave: "à", Agrave: "À", acirc: "â", Acirc: "Â", atilde: "ã", Atilde: "Ã",
  eacute: "é", Eacute: "É", ecirc: "ê", Ecirc: "Ê", iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó",
  ocirc: "ô", Ocirc: "Ô", otilde: "õ", Otilde: "Õ", uacute: "ú", Uacute: "Ú", uuml: "ü", Uuml: "Ü", ccedil: "ç", Ccedil: "Ç",
  middot: "·", plusmn: "±", times: "×", divide: "÷", le: "≤", ge: "≥", beta: "β", alpha: "α", gamma: "γ", mu: "μ",
};
function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}
/** Remove tags HTML e entidades (&gt; &lt;) e normaliza espaços (limpar() de portal.py). */
function limpar(valor: unknown): string {
  const texto = String(valor ?? "").replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  return unescapeHtml(texto).replace(/\s+/g, " ").trim();
}
function celulasParaDict(cell: unknown[], colunas: string[]): Record<string, unknown> {
  const c = cell.length === colunas.length + 1 ? cell.slice(1) : cell; // multiselect inclui a coluna "cb"
  const d: Record<string, unknown> = {};
  colunas.forEach((k, i) => { d[k] = c[i]; });
  return d;
}
/** InfoPac = Base64("idRequisicao||unidade||...") → lista de campos. */
function decodificarInfopac(valor: unknown): string[] {
  // como base64.b64decode do Python (validate=False): ignora caracteres fora do alfabeto base64
  const bruto = limpar(valor).replace(/[^A-Za-z0-9+/]/g, "");
  if (!bruto) return [];
  try {
    const bin = atob(bruto + "=".repeat((4 - (bruto.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))).split("||");
  } catch {
    return [];
  }
}
/* datas como "aaaa-mm-dd" (sem fuso) */
const isoParaDia = (iso: string) => { const [a, m, d] = iso.split("-").map(Number); return Date.UTC(a, m - 1, d) / 864e5; };
const diaParaIso = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
const diaParaBr = (n: number) => { const [a, m, d] = diaParaIso(n).split("-"); return `${d}/${m}/${a}`; };
function diaDoPedido(p: Record<string, unknown>): number | null {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(limpar(p.Entrada));
  if (!m) return null;
  const t = Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const dt = new Date(t);
  return dt.getUTCDate() === +m[1] && dt.getUTCMonth() === +m[2] - 1 ? t / 864e5 : null;
}
/** [fim - dias + 1, fim] em janelas de até 90 dias, da mais recente à mais antiga (janelas() de clinica.py). */
function janelas(dias: number, fim: number): [number, number][] {
  const limite = fim - (dias - 1), out: [number, number][] = [];
  while (fim >= limite) {
    const inicio = Math.max(fim - (JANELA_MAX_DIAS - 1), limite);
    out.push([inicio, fim]);
    fim = inicio - 1;
  }
  return out;
}

/* ---------------- sessão HTTP com o portal ---------------- */
type Info = { tks: string; unidade: string; optsA: string; optsB: string; unidades: { valor: string; nome: string }[] };

function decodificar(buf: ArrayBuffer, tipo: string | null): string {
  const cs = /charset=([\w-]+)/i.exec(tipo ?? "")?.[1]?.toLowerCase();
  if (cs && cs !== "utf-8" && cs !== "utf8") { try { return new TextDecoder(cs).decode(buf); } catch { /* segue */ } }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("latin1").decode(buf); }
}
function valorDoCampo(html: string, id: string): string {
  const inp = new RegExp(`<input\\b[^>]*\\bid=["']?${id}["']?[^>]*>`, "i").exec(html);
  if (inp) return unescapeHtml(/\bvalue=["']([^"']*)["']/i.exec(inp[0])?.[1] ?? "");
  const sel = new RegExp(`<select\\b[^>]*\\bid=["']?${id}["']?[^>]*>([\\s\\S]*?)</select>`, "i").exec(html);
  if (!sel) return "";
  const opts = opcoes(sel[1]);
  return (opts.find((o) => o.selecionada) ?? opts[0])?.valor ?? "";
}
function opcoes(miolo: string) {
  return [...miolo.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((m) => ({
    valor: unescapeHtml(/\bvalue=["']([^"']*)["']/i.exec(m[1])?.[1] ?? limpar(m[2])),
    nome: limpar(m[2]),
    selecionada: /\bselected\b/i.test(m[1]),
  }));
}

class Sessao {
  cookies = new Map<string, string>();
  info: Info | null = null;
  constructor(private usuario: string, private senha: string) {}

  private guardar(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }
  async pedir(url: string, init: RequestInit = {}): Promise<{ status: number; texto: string }> {
    let alvo = url;
    for (let salto = 0; salto < 5; salto++) {
      const h = new Headers(init.headers);
      h.set("User-Agent", UA);
      if (this.cookies.size) h.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
      const res = await fetch(alvo, { ...init, headers: h, redirect: "manual", signal: AbortSignal.timeout(25000) });
      this.guardar(res);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        alvo = new URL(loc, alvo).toString();
        init = { method: "GET" };
        continue;
      }
      return { status: res.status, texto: decodificar(await res.arrayBuffer(), res.headers.get("content-type")) };
    }
    throw new ErroPortal("Redirecionamentos demais no portal.", "REDE");
  }

  async conectar() {
    this.cookies.clear();
    const p1 = await this.pedir(URL_LOGIN);
    if (p1.status >= 400) throw new ErroPortal(`O portal respondeu HTTP ${p1.status} na página inicial.`, "HTTP");
    const form = new URLSearchParams({
      ztmAction: "S", ztmAcesso: "S", ztmCaptcha: "NADA", ztmToken: "",
      ztmLogin: this.usuario, ztmSenha: this.senha, ztmCliente: "", ztmOptLogin: "consultas",
      ztmClienteStatus: "", ztmSitesExternos: "",
    });
    const p2 = await this.pedir(PORTAL + "/laudos/z_login.php", {
      method: "POST", body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Referer: URL_LOGIN, Origin: PORTAL },
    });
    const [codigo, extra = ""] = p2.texto.trim().split("||");
    if (codigo !== "OK") {
      const msg = ERROS_LOGIN[codigo];
      throw new ErroPortal(msg ?? "Resposta inesperada do portal no login.", msg ? codigo : "DESCONHECIDO",
        codigo === "AcessoIpNegado" ? extra.slice(0, 64) : msg ? undefined : p2.texto.trim().slice(0, 80).replace(/\s+/g, " "));
    }
    const p3 = await this.pedir(URL_CONSULTAS, { headers: { Referer: URL_LOGIN } });
    const tks = valorDoCampo(p3.texto, "ztmAcaoTks");
    if (!tks) throw new ErroPortal("Login feito, mas a tela de consulta não trouxe o token de acesso.", "TOKEN");
    const sel = /<select\b[^>]*\bid=["']?ztmUnidade["']?[^>]*>([\s\S]*?)<\/select>/i.exec(p3.texto);
    this.info = {
      tks,
      unidade: valorDoCampo(p3.texto, "ztmUnidade"),
      optsA: valorDoCampo(p3.texto, "ztmOptsMultiplasA"),
      optsB: valorDoCampo(p3.texto, "ztmOptsMultiplasB"),
      unidades: sel ? opcoes(sel[1]).map(({ valor, nome }) => ({ valor, nome })) : [],
    };
  }

  async post(down: string, page: number, rows: number, dados: Record<string, string>, tentativa = 1): Promise<any> {
    if (!this.info) await this.conectar();
    const corpo = new URLSearchParams({
      _search: "false", nd: String(Date.now()), rows: String(rows), page: String(page),
      sidx: "", sord: "asc", ...dados, ztmAcaoTks: this.info!.tks,
    });
    const url = `${URL_DADOS}?${new URLSearchParams({ down, page: String(page), rows: String(rows) })}`;
    const r = await this.pedir(url, {
      method: "POST", body: corpo.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01", Referer: URL_CONSULTAS, Origin: PORTAL,
      },
    });
    try {
      if (r.status >= 400) throw new Error("http");
      return JSON.parse(r.texto);
    } catch {
      // Resposta não-JSON (tela de login / sessão encerrada): refaz o login uma vez.
      if (tentativa === 1) { await this.conectar(); return this.post(down, page, rows, dados, 2); }
      throw new ErroPortal("O portal não devolveu dados válidos mesmo após novo login.", "SESSAO");
    }
  }

  async listarPedidos(prontuario: string, inicio: number, fim: number, unidade: string) {
    if (!this.info) await this.conectar();
    const dados: Record<string, string> = {
      ztmUnidade: unidade, ztmDataInicio: diaParaBr(inicio), ztmDataFinal: diaParaBr(fim),
      ztmRequisicao: "", ztmSetor: "", ztmPosto: "", ztmProntuario: prontuario, ztmNascimento: "",
      ztmOptsMultiplasA: this.info!.optsA || "pac_st_nome", ztmOptsMultiplasB: this.info!.optsB || "pac_in_codsus",
      ztmCodMultiplosB: "", ztmPacNomeA: "", ztmPacNomeB: "", ztmPacNomeC: "",
      ztmProcedimento: "", ztmCkImpresso: "N", ztmCkLiberado: "N", ztmCkUrgente: "N",
    };
    // ATENÇÃO: com ztmProntuario preenchido o portal ignora o filtro de datas E a paginação
    // (devolve o histórico inteiro em toda página). Por isso paramos quando nada novo chega
    // e recortamos o período aqui.
    const pedidos: Record<string, unknown>[] = [], vistos = new Set<string>();
    for (let pagina = 1; pagina <= 100; pagina++) {
      const j = await this.post("R", pagina, PEDIDOS_POR_PAGINA, dados);
      let novos = 0;
      for (const row of j?.rows ?? []) {
        const p = celulasParaDict(row?.cell ?? [], COLUNAS_PEDIDO);
        const chave = limpar(p.Solicita) || limpar(p.InfoPac);
        if (vistos.has(chave)) continue;
        vistos.add(chave); pedidos.push(p); novos++;
      }
      const registros = parseInt(j?.records ?? "0", 10) || 0;
      if (novos === 0 || pedidos.length >= registros || pagina >= (parseInt(j?.total ?? "1", 10) || 1)) break;
    }
    return pedidos.filter((p) => { const d = diaDoPedido(p); return d === null || (inicio <= d && d <= fim); });
  }

  async resultadosDoPedido(infopac: string, unidadeFiltro: string) {
    const campos = decodificarInfopac(infopac);
    if (!campos.length || !campos[0]) throw new ErroPortal("Não foi possível decodificar o identificador do pedido (InfoPac).");
    const unidade = campos.length > 1 && /^\d+$/.test(campos[1]) ? campos[1] : unidadeFiltro;
    const j = await this.post("D", 1, 10000, {
      ztmRequisicaoId: campos[0], ztmUnidadeCod: unidade, ztmSetorCod: "", ztmGrava: "S",
      ztmCkImpresso: "N", ztmCkLiberado: "N", ztmCheckGridOcultaIngressos: "N", ztmOrder: "",
    });
    return (j?.rows ?? []).map((row: any) => {
      const d = celulasParaDict(row?.cell ?? [], COLUNAS_RESULTADO);
      return { Parametro: limpar(d.Parametro), Result: limpar(d.Result), Calcu: limpar(d.Calcu), Unidmed: limpar(d.Unidmed), Flegui: limpar(d.Flegui) };
    });
  }
}

/* confere se quem chama é um usuário logado no Anamnesia */
async function usuarioLogado(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const base = Deno.env.get("SUPABASE_URL");
  if (!base || !/^Bearer\s+\S+/.test(auth)) return false;
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey, Authorization: auth }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return false;
    const u = await r.json();
    return !!(u && u.id);
  } catch {
    return false;
  }
}

/* ---------------- ações ---------------- */
async function acaoLogin(s: Sessao) {
  await s.conectar();
  return { ok: true, unidade: s.info!.unidade, unidades: s.info!.unidades };
}

async function acaoPedidos(s: Sessao, b: any) {
  const prontuario = String(b.prontuario ?? "").replace(/\D/g, "");
  if (!prontuario) throw new ErroPortal("Prontuário deve conter apenas números.", "ENTRADA");
  const dias = Math.min(MAX_DIAS, Math.max(1, parseInt(b.dias, 10) || 30));
  const fimIso = /^\d{4}-\d{2}-\d{2}$/.test(b.fim ?? "") ? b.fim : new Date().toISOString().slice(0, 10);
  await s.conectar();
  const unidade = String(b.unidade ?? "") || s.info!.unidade;
  const lista = janelas(dias, isoParaDia(fimIso));
  const pedidos: Record<string, unknown>[] = [], lidos = new Set<string>();
  for (const [inicio, fim] of lista) {
    for (const p of await s.listarPedidos(prontuario, inicio, fim, unidade)) {
      const chave = limpar(p.Solicita) || String(p.InfoPac ?? "");
      if (lidos.has(chave)) continue;
      lidos.add(chave); pedidos.push(p);
    }
  }
  return {
    ok: true, unidade, unidades: s.info!.unidades, janelas: lista.length,
    pedidos: pedidos.map((p) => ({
      solicitacao: limpar(p.Solicita), entrada: limpar(p.Entrada), prontuario: limpar(p.Prontuario),
      sexo: limpar(p.Sexo), sexoDesc: limpar(p.SexoDesc), status: limpar(p.Status), infopac: limpar(p.InfoPac),
    })),
  };
}

async function acaoResultados(s: Sessao, b: any) {
  const lista = Array.isArray(b.pedidos) ? b.pedidos.slice(0, MAX_PEDIDOS_POR_LOTE) : [];
  if (!lista.length) throw new ErroPortal("Nenhum pedido informado.", "ENTRADA");
  await s.conectar();
  const unidade = String(b.unidade ?? "") || s.info!.unidade;
  const out = [];
  for (const p of lista) {
    const infopac = String(p?.infopac ?? "");
    try {
      out.push({ infopac, linhas: await s.resultadosDoPedido(infopac, unidade) });
    } catch (e) {
      out.push({ infopac, erro: e instanceof ErroPortal ? e.message : "Falha ao ler o pedido." });
    }
  }
  return { ok: true, resultados: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, erro: "Use POST." });
  if (!(await usuarioLogado(req))) return json(req, 401, { ok: false, erro: "Entre na sua conta do Anamnesia para usar esta função." });

  let b: any = {};
  try { b = await req.json(); } catch { /* corpo inválido */ }
  const usuario = String(b?.usuario ?? "").trim(), senha = String(b?.senha ?? "");
  if (!usuario || !senha) return json(req, 400, { ok: false, erro: "Informe usuário e senha do portal." });

  const s = new Sessao(usuario, senha);
  const inicio = Date.now();
  try {
    const acao = String(b.acao ?? "login");
    const r = acao === "pedidos" ? await acaoPedidos(s, b)
      : acao === "resultados" ? await acaoResultados(s, b)
      : acao === "login" ? await acaoLogin(s)
      : null;
    if (!r) return json(req, 400, { ok: false, erro: "Ação desconhecida." });
    return json(req, 200, { ...r, ms: Date.now() - inicio });
  } catch (e) {
    if (e instanceof ErroPortal) return json(req, 200, { ok: false, codigo: e.codigo, erro: e.message, detalhe: e.detalhe });
    const msg = e instanceof Error ? e.message : String(e);
    const tempo = /timed out|timeout|abort/i.test(msg);
    return json(req, 200, { ok: false, codigo: "REDE", erro: tempo ? "O portal não respondeu a tempo." : "Falha de rede ao falar com o portal.", detalhe: msg.slice(0, 120) });
  }
});

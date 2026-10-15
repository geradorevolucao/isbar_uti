// Anamnesia — teste de login no portal Biomega/Lisnet (Supabase Edge Function).
//
// Primeiro passo da integração: só faz o login por HTTP (sem Chrome) e confere se a
// página de consultas abre, para saber se o portal aceita acesso vindo da nuvem.
// - Exige usuário logado no Anamnesia (token do Supabase); sem isso, recusa.
// - Usuário e senha do portal chegam só nesta requisição: não são gravados nem logados.
// - Devolve apenas o resultado do login (OK ou o código de erro do portal), nunca cookies,
//   tokens ou o HTML do portal.

const PORTAL = (Deno.env.get("BIOMEGA_BASE") ?? "https://biomega.lisnet.com.br").replace(/\/+$/, "");
const ORIGENS = ["https://anamnesia.net.br", "https://www.anamnesia.net.br", "null", "http://localhost", "http://127.0.0.1"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ERROS: Record<string, string> = {
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

/* sessão HTTP mínima: guarda os cookies e segue redirecionamentos */
class Sessao {
  cookies = new Map<string, string>();
  guardar(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }
  async pedir(url: string, init: RequestInit = {}): Promise<{ status: number; texto: string; url: string }> {
    let alvo = url;
    for (let salto = 0; salto < 5; salto++) {
      const h = new Headers(init.headers);
      h.set("User-Agent", UA);
      if (this.cookies.size) h.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
      const res = await fetch(alvo, { ...init, headers: h, redirect: "manual", signal: AbortSignal.timeout(20000) });
      this.guardar(res);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        alvo = new URL(loc, alvo).toString();
        init = { method: "GET" };
        continue;
      }
      // o portal usa ISO-8859-1; latin1 preserva os bytes
      const texto = new TextDecoder("latin1").decode(await res.arrayBuffer());
      return { status: res.status, texto, url: alvo };
    }
    throw new Error("Redirecionamentos demais");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, erro: "Use POST." });
  if (!(await usuarioLogado(req))) return json(req, 401, { ok: false, erro: "Entre na sua conta do Anamnesia para usar esta função." });

  let usuario = "", senha = "";
  try {
    const b = await req.json();
    usuario = String(b?.usuario ?? "").trim();
    senha = String(b?.senha ?? "");
  } catch { /* corpo inválido */ }
  if (!usuario || !senha) return json(req, 400, { ok: false, erro: "Informe usuário e senha do portal." });

  const s = new Sessao();
  const inicio = Date.now();
  try {
    // 1) cookie de sessão
    const p1 = await s.pedir(`${PORTAL}/laudos/`);
    if (p1.status >= 400) return json(req, 200, { ok: false, etapa: "pagina-inicial", http: p1.status, erro: `O portal respondeu HTTP ${p1.status} na página inicial.` });

    // 2) login (perfil "consultas", sem captcha)
    const form = new URLSearchParams({
      ztmAction: "S", ztmAcesso: "S", ztmCaptcha: "NADA", ztmToken: "",
      ztmLogin: usuario, ztmSenha: senha, ztmCliente: "", ztmOptLogin: "consultas",
      ztmClienteStatus: "", ztmSitesExternos: "",
    });
    const p2 = await s.pedir(`${PORTAL}/laudos/z_login.php`, {
      method: "POST",
      body: form.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${PORTAL}/laudos/`,
        "Origin": PORTAL,
      },
    });
    const resp = p2.texto.trim();
    const [codigo, extra = ""] = resp.split("||");
    if (codigo !== "OK") {
      const conhecido = ERROS[codigo];
      return json(req, 200, {
        ok: false, etapa: "login", http: p2.status, codigo: conhecido ? codigo : "DESCONHECIDO",
        erro: conhecido ?? "Resposta inesperada do portal no login.",
        // para AcessoIpNegado o portal informa o IP recusado (útil para o diagnóstico)
        detalhe: codigo === "AcessoIpNegado" ? extra.slice(0, 64) : undefined,
        amostra: conhecido ? undefined : resp.slice(0, 80).replace(/\s+/g, " "),
      });
    }

    // 3) página de consultas: precisa ter o token ztmAcaoTks e as unidades
    const p3 = await s.pedir(`${PORTAL}/laudos/consultas/`, { headers: { Referer: `${PORTAL}/laudos/` } });
    const temToken = /id=["']?ztmAcaoTks["']?[^>]*value=["'][^"']+["']|value=["'][^"']+["'][^>]*id=["']?ztmAcaoTks/i.test(p3.texto);
    const sel = /<select[^>]*(?:id|name)=["']?ztmUnidade["']?[^>]*>([\s\S]*?)<\/select>/i.exec(p3.texto);
    const unidades = sel ? (sel[1].match(/<option\b/gi) ?? []).length : 0;
    return json(req, 200, {
      ok: temToken, etapa: "consultas", http: p3.status, codigo: "OK",
      token_encontrado: temToken, unidades, ms: Date.now() - inicio,
      erro: temToken ? undefined : "O login foi aceito, mas a página de consultas não trouxe o token esperado.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tempo = /timed out|timeout|abort/i.test(msg);
    return json(req, 200, { ok: false, etapa: "rede", erro: tempo ? "O portal não respondeu a tempo (20 s)." : "Falha de rede ao falar com o portal.", detalhe: msg.slice(0, 120) });
  }
});

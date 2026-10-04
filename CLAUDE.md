# Anamnesia — contexto do projeto

Prontuário eletrônico pessoal ("o prontuário eletrônico que te lembra do que não esquecer") para uso de um médico residente: evoluções de CTI, enfermaria de clínica médica e interconsulta de hematologia, além de uma proposta de prescrição para discussão com a preceptoria.

## Preferências do autor (seguir sempre)
- Responder em português do Brasil.
- Seguir exatamente o que for pedido, sem extrapolar conteúdo clínico não solicitado.
- Em qualquer conteúdo médico (campos, fórmulas, condutas), citar a bibliografia usada.
- Não pré-preencher doses ou condutas: o app é um formulário; o conteúdo clínico é do autor.

## Arquitetura
- **Um único arquivo `index.html`** (HTML + CSS + JS inline, sem dependências externas nem CDN). Precisa continuar funcionando offline e aberto direto do disco (`file://`), porque a rede do hospital bloqueia alguns sites.
- **Publicação:** GitHub Pages (usuário `geradorevolucao`, branch `main`, pasta raiz), com domínio próprio `anamnesia.net.br`.
- **`supabase-setup.sql`:** cria as tabelas `records` e `user_keys` com Row Level Security, e um gatilho que recusa gravações mais antigas (comparando `updated_at`) e carimba `server_ts`. Pode ser rodado de novo sem perder dados. `user_keys` só aceita leitura e criação (sem update/delete).

## Telas (`body[data-view]`)
1. **Tela inicial** (`#home`): saudação animada com traçado de ECG. Respeita `prefers-reduced-motion`. O botão "Começar" leva à lista.
2. **Meus pacientes** (`list`): adicionar, editar, mudar de módulo e excluir pacientes; filtro por módulo e busca por nome ou leito.
3. **Prontuário** (`chart`): formulário gerado a partir de um esquema declarativo (`CTI`, `ENF`, `IC`). "Gerar texto" monta o texto para colar no prontuário oficial.
4. **Prescrição** (`rx`): proposta com itens nas situações Manter, Nova, Alterar ou Suspender, e aprazamento automático a partir da frequência e do 1º horário. A impressão leva a marca-d'água "SIMULAÇÃO – NÃO VÁLIDA" e o aviso de que não serve para dispensação. **Manter essa identificação**: a folha não pode ser confundida com uma prescrição real, e não deve usar logotipo do hospital ou do MV.

## Modelos de evolução (objeto `TPL`)
- **`cti`, ISBAR:** I/S/B/A/R, com a avaliação por sistemas e o checklist FAST HUGS BID. Campos calculados: PAM; Glasgow total (V = T no paciente intubado); peso predito (fórmula ARDSNet); VC em mL/kg de peso predito; driving pressure; complacência; P/F; diurese em mL/kg/h; ânion gap.
- **`enf`, Enfermaria de clínica médica:** Lista de problemas, Contexto, HPP, MUC, Evolução diária, Dados vitais, Exame físico, Exames complementares e Condutas. Cada problema tem 4 subtópicos: Apresentação, Etiologia, Propedêutica e Plano de cuidados (campo do tipo `problems`). "Nova evolução do dia" apaga os campos diários e soma 1 ao DIH.
- **`ic`, Interconsulta de hematologia:** segue a folha de rosto da interconsulta da residência (docx enviado pelo autor). O modelo é dinâmico (`build: icModel`): o campo `ic_mom` escolhe entre 1ª avaliação, Avaliações subsequentes e Após diagnóstico; neste último, `ic_dx` escolhe o bloco da doença (aplasia de medula óssea, PTI, trombose, mieloma múltiplo, linfoma, SMD, leucemia aguda), seguido de Internação (comorbidades, cateter, transfusão, profilaxias, intercorrências) e Evolução (DE, evolução, ao exame, CD).
  - Campos com o mesmo significado usam a mesma chave em todos os modelos, para os dados serem aproveitados na troca.
  - O texto (`icText`) segue o formato da folha: começa com `# INTERCONSULTA – HEMATOLOGIA #`. As seções Identificação e Momento não entram no texto. Os grupos têm `tx: { h, m }` (`in`: uma linha; `bl`: título e linhas "- "; `lf`: um campo por linha) e os campos podem ter `blk` (subtítulo do bloco, como "1) INFECCIOSA").
  - Superfície corpórea calculada pela fórmula de Mosteller.
  - "Nova avaliação" apaga Evolução, Ao exame e CD, passa a 1ª avaliação para Avaliações subsequentes e avança o "Hoje D" da QT pelos dias passados.
  - Dados do modelo antigo da IC continuam guardados; `tipo: "Seguimento"` é migrado para `ic_mom: "Avaliações subsequentes"`.
- Tipos de campo: `text`, `num`, `area`, `date`, `radio`, `check`, `calc`, `pair`, `gcs`, `list`, `problems`. Opções: `def` (valor padrão de um radio), `tl` (rótulo no texto gerado; `""` imprime só o valor), `daily` (apagado na nova evolução), `ph` (exemplo em cinza, não entra no texto).

## Dados
- **Armazenamento local:** `localStorage["isbar-cti-v1"]` guarda `{ mode, currentBy, patients: { id: { tpl, updated, data, presc } }, settings, sync }`. A chave antiga foi mantida para preservar os dados já salvos; `normalizeStore()` migra a versão antiga, que tinha só CTI.
- **Conta ativa:** o cache local fica cifrado em `isbar-enc-v1`, e a cópia em texto aberto é apagada.
- **Sincronização (Supabase, via REST, sem SDK):**
  - Login por e-mail (GoTrue).
  - Criptografia de ponta a ponta: AES-GCM 256 com chave derivada por PBKDF2-SHA-256 (600 mil iterações) a partir da senha de criptografia, que nunca sai do aparelho.
  - A chave pode ficar lembrada no IndexedDB, como chave não exportável.
  - Conflitos: vale a última versão de cada paciente; exclusões são enviadas como marcação (*tombstone*).
- **Configuração da sincronização:** as constantes `SYNC_URL` e `SYNC_ANON_KEY` no topo do script, ou digitadas na tela "Conta e sincronização".
- **HTTPS obrigatório:** `crypto.subtle` só existe em contexto seguro, então a conta não funciona via `http://`.

## Testes (como foram feitos)
- **Playwright (Chromium headless):** fluxos de lista, prontuário, prescrição e impressão (`page.pdf` com `emulate_media("print")`), migração de dados antigos e modo escuro.
- **Sincronização:** um servidor Python que simula o Supabase (rotas `/auth/v1/*`, `/rest/v1/records`, `/rest/v1/user_keys`), com dois contextos de navegador fazendo o papel de dois aparelhos.
- **Nos testes, clicar em `#homeGo` antes de interagir**, porque a tela inicial cobre o app.
- **`supabase-setup.sql`:** testado em PostgreSQL 16 local com um esquema `auth` simulado (`auth.users`, `auth.uid()`, papéis `anon`/`authenticated`): RLS entre dois usuários, upsert mais antigo ignorado, *tombstone* aceito e reexecução do script.

## Pendências
- **Enforce HTTPS no GitHub Pages:** o DNS está correto (4 registros A apontando para o GitHub e CNAME `www` para `geradorevolucao.github.io`), mas o certificado ainda não tinha sido emitido. Sugestão: remover e salvar de novo o domínio em Settings → Pages.
- **Supabase:** criar o projeto, rodar `supabase-setup.sql`, definir o Site URL como `https://anamnesia.net.br` e desativar novos cadastros depois de criar a conta.

## Decisões do autor
- Grafia: **"Anamnesia"**, sem acento.
- Manter o web app como está, inclusive a seção Condutas da enfermaria, até o autor pedir mudanças.

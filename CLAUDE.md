# Anamnesia — contexto do projeto

Prontuário eletrônico pessoal ("o prontuário eletrônico que te lembra do que não esquecer") para uso de um médico residente: evoluções de CTI, enfermaria de clínica médica e interconsulta de hematologia, além de uma proposta de prescrição para discussão com a preceptoria.

## Preferências do autor (seguir sempre)
- Responder em português do Brasil.
- Seguir exatamente o que for pedido, sem extrapolar conteúdo clínico não solicitado.
- Em qualquer conteúdo médico (campos, fórmulas, condutas), citar a bibliografia usada.
- Não pré-preencher doses ou condutas: o app é um formulário; o conteúdo clínico é do autor. Exceção pedida pelo autor: o catálogo de opções da prescrição (`RX_CAT`), que só entra quando o autor escolhe uma opção, fica sempre editável e tem as referências em `RX_CAT_REFS`.

## Arquitetura
- **Um único arquivo `index.html`** (HTML + CSS + JS inline, sem dependências externas nem CDN). Precisa continuar funcionando offline e aberto direto do disco (`file://`), porque a rede do hospital bloqueia alguns sites.
- **Publicação:** GitHub Pages (usuário `geradorevolucao`, branch `main`, pasta raiz), com domínio próprio `anamnesia.net.br`.
- **`supabase-setup.sql`:** cria as tabelas `records` e `user_keys` com Row Level Security, e um gatilho que recusa gravações mais antigas (comparando `updated_at`) e carimba `server_ts`. Pode ser rodado de novo sem perder dados. `user_keys` só aceita leitura e criação (sem update/delete).

## Telas (`body[data-view]`)
1. **Tela inicial** (`#home`): saudação animada com traçado de ECG. Respeita `prefers-reduced-motion`. O botão "Começar" leva à lista.
2. **Meus pacientes** (`list`): adicionar, editar, mudar de módulo e excluir pacientes; filtro por módulo e busca por nome ou leito.
3. **Prontuário** (`chart`): formulário gerado a partir de um esquema declarativo (`CTI`, `ENF`, `IC`). "Gerar texto" monta o texto para colar no prontuário oficial.
4. **Prescrição** (`rx`): proposta com itens nas situações Manter, Nova, Alterar ou Suspender, e aprazamento automático a partir da frequência e do 1º horário. Os botões "+ Escolher dieta" e "+ Escolher da lista" abrem o catálogo `RX_CAT` (dieta, sintomáticos, anticoagulação, correção de glicose, antibioticoterapia, anti-hipertensivos, betabloqueadores, estatinas, protetores gástricos, laxativos, diuréticos e antiagregantes), com busca pelo começo das palavras e filtro por categoria; a opção escolhida entra como "Nova", com descrição, dose, via, frequência e observação preenchidas. A impressão leva a marca-d'água "SIMULAÇÃO – NÃO VÁLIDA" e o aviso de que não serve para dispensação. **Manter essa identificação**: a folha não pode ser confundida com uma prescrição real, e não deve usar logotipo do hospital ou do MV.

## Modelos de evolução (objeto `TPL`)
- **`cti`, ISBAR:** I/S/B/A/R, com a avaliação por sistemas e o checklist FAST HUGS BID. Campos calculados: PAM; Glasgow total (V = T no paciente intubado); peso predito (fórmula ARDSNet); VC em mL/kg de peso predito; driving pressure; complacência; P/F; diurese em mL/kg/h; ânion gap.
- **`enf`, Enfermaria de clínica médica:** Lista de problemas, Contexto, HPP, MUC, Evolução diária, Dados vitais, Exame físico, Exames complementares e Condutas. Cada problema tem 4 subtópicos: Apresentação, Etiologia, Propedêutica e Plano de cuidados (campo do tipo `problems`). "Nova evolução do dia" apaga os campos diários e soma 1 ao DIH.
  - **Admissão / Evolução** (campo `enf_mom`, modelo dinâmico `enfModel`). Fichas novas nascem em Admissão (`newData`); fichas sem a marca, anteriores a essa mudança, ficam em Evolução.
  - **Admissão** (modelo do autor, texto por `admText`): Situação (cards com Apresentação, Etiologia, Propedêutica externa, Propedêutica interna e Plano de cuidados; título vazio sai como "Situação a esclarecer"), Contexto, HPP, MUC, Alergias, HF, HSE, Cirurgias prévias, Exames externos (a) Laboratório, b) Imagem) e Condutas em lista com "- ". O texto usa os títulos "| Situação:", "| Contexto:" etc. e não imprime a identificação.
  - As situações usam a mesma chave da lista de problemas (`prob`). Em "Nova evolução do dia" a ficha passa para Evolução: a propedêutica externa e interna é copiada para "Propedêutica" (se vazia) e título vazio vira "Situação a esclarecer". Contexto, HPP (`comorb`), MUC, alergias e cirurgias também são compartilhados.
  - O campo `problems` aceita `subs` (subtópicos), `item` (nome do card) e `itemPh` (exemplo do título).
  - **Impressão:** situações e problemas saem no formato do texto gerado: "1. Título" e uma linha "- Subtópico:" por item, também em branco. Na impressão (inclusive Ctrl+P), `fitProbAreas` faz os subtópicos crescerem até mostrar todo o texto.
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
- **Configuração da sincronização:** o projeto Supabase do autor é `https://lykqudxhjnvsiprrkinh.supabase.co` (o arquivo `supabase init` do repositório é de **outro** projeto, `cspsiakuwuqegugfxepb`; não usar). O servidor digitado no aparelho ("Conta e sincronização" → Configurar servidor, guardado em `isbar-sync-cfg`) tem prioridade; as constantes `SYNC_URL` e `SYNC_ANON_KEY` servem para aparelhos sem configuração (ex.: abrir código num PC do hospital). "Alterar servidor" aparece sempre.
- **HTTPS obrigatório:** `crypto.subtle` só existe em contexto seguro, então a conta não funciona via `http://`.

## Enviar o texto para outro computador (janela do texto gerado → "Enviar para outro computador")
- **E-mail:** "Abrir no app de e-mail" (`mailto:`) ou "Abrir no Gmail (web)", já com destinatário, assunto (momento, leito e data, sem o nome) e o texto no corpo; o texto também é copiado. O último e-mail fica lembrado no aparelho (`isbar-mailto`). Não há envio automático pelo servidor.
- **Código temporário** (no lugar do invertexto.com, que não tem forma oficial de gravar por outro site): código de 12 caracteres (alfabeto sem 0/O/1/I, 60 bits), validade de 2, 12 ou 24 h. O texto é cifrado no aparelho (AES-GCM, chave = PBKDF2 do código, 100 mil iterações); a tabela `shares` guarda só o SHA-256 do código e o texto cifrado. Gerar exige estar logado; abrir não exige: tela inicial ou ⋯ → "Abrir texto por código", que chama a função `get_share` (só devolve o código exato e não vencido). Os vencidos são apagados a cada novo código; "Apagar agora" apaga na hora.

## Integração com o Biomega/Lisnet (em andamento)
- **Objetivo:** puxar exames do portal Biomega/Lisnet de dentro do Anamnesia, sem depender do app Flask no PC de casa nem do Tailscale. Custo zero; credenciais e resultados só em memória, sem gravar. A rotina diária das 05:00 continua no PC.
- **Login pela nuvem validado** pelo autor em 15/10/2026 (projeto `lykqudxhjnvsiprrkinh`): o portal aceitou o login vindo do Supabase, sem bloqueio por IP.
- **Função `supabase/functions/biomega/index.ts`** (Deno; porte de `portal.py` sem Selenium). Ações no corpo JSON (`acao`):
  - `login`: só testa o login e devolve as unidades;
  - `pedidos`: lista os pedidos do prontuário no período, em janelas de 90 dias, com o recorte de datas feito na função (o portal ignora datas e paginação quando há prontuário);
  - `resultados`: busca os resultados de até 10 pedidos.
  Cada chamada faz o próprio login (GET `/laudos/` → POST `z_login.php`, perfil "consultas", `ztmCaptcha=NADA` → GET `/laudos/consultas/` para ler `ztmAcaoTks`, unidade e `ztmOptsMultiplasA/B`) e não guarda nada. Exige usuário logado (valida o token em `/auth/v1/user`); devolve só campos limpos (sem cookies, token ou HTML). Substitui a `biomega-login` do passo 1. **Publicada pelo autor e login validado em 15/10/2026.** Atenção: no Supabase, o endereço da função (`/functions/v1/<nome>`) é definido pelo nome dado na criação; renomear depois não muda o endereço. Por isso foi preciso criar uma função nova chamada `biomega`, em vez de editar a `biomega-login`.
- **No app (`BIO`, perto de "INICIALIZAÇÃO")**: porte fiel de `clinica.py` (`prepararPedidos` + `processar`, `formatarDocumento`), `formato_prontuario.py` (`formatar`) e `series.py` (`series`). Equivalência conferida contra os arquivos Python originais em 4.500 casos sintéticos (saída idêntica) e de ponta a ponta com um portal simulado. Para mudar regras (siglas, ordem, limiares), editar as mesmas tabelas que no Python (`ORDEM`, `REGRAS`, `ABREVIACOES_DEMAIS` etc.).
- **Janela "Exames do Biomega"** (⋯ no prontuário): prontuário (guardado na ficha em `bio_pront`), período (7 a 365 dias) e unidade; busca os pedidos e depois os resultados em lotes de 8 (`BIO_LOTE`); mostra o formato prontuário ou o documento completo (opção de marcar alterados), os avisos e minigráficos de evolução (exames com 2 ou mais datas, com os valores em texto embaixo). "Inserir no prontuário" acrescenta o texto ao campo escolhido (padrão: "a) Laboratório" na admissão, "Outros laboratoriais" na evolução). Os resultados ficam só na memória da janela.
- **Senha do portal lembrada no aparelho** (pedido do autor): em `store.settings.biomega` (`bioCred`/`setBioCred`), só com a conta ativa, porque aí o store é gravado cifrado em `isbar-enc-v1` com a mesma chave dos prontuários. É salva só depois de um login aceito. Não vai para o servidor (a sincronização envia só os pacientes) nem para o backup `.json`; `saveNow` tira `biomega` da cópia em texto aberto; "Esquecer usuário e senha" e "Sair da conta" apagam.
- **Não ler nem copiar** do PC do autor: `credenciais.dat`, `segredos.py`, `config_local.json`.

## Testes (como foram feitos)
- **Playwright (Chromium headless):** fluxos de lista, prontuário, prescrição e impressão (`page.pdf` com `emulate_media("print")`), migração de dados antigos e modo escuro.
- **Sincronização:** um servidor Python que simula o Supabase (rotas `/auth/v1/*`, `/rest/v1/records`, `/rest/v1/user_keys`), com dois contextos de navegador fazendo o papel de dois aparelhos.
- **Nos testes, clicar em `#homeGo` antes de interagir**, porque a tela inicial cobre o app.
- **Código temporário:** servidor Node que simula `/rest/v1/shares` e `/rest/v1/rpc/get_share`, com dois contextos de navegador (gerar e abrir). A tabela `shares` foi testada no PostgreSQL local (RLS, limite de 24 h, `get_share` para `anon`, limpeza dos vencidos).
- **`biomega`:** `deno check`; equivalência do porte (`BIO`) contra os `.py` originais do autor (stub de `portal.py`), em 4.500 casos sintéticos, com saída idêntica em todos os formatos; e teste de ponta a ponta (app → função → portal simulado com o formato jqGrid e entidades HTML), comparando o texto final com o do Python: login errado, prontuário diferente, lotes, gráficos e inserção no prontuário.
- **`supabase-setup.sql`:** testado em PostgreSQL 16 local com um esquema `auth` simulado (`auth.users`, `auth.uid()`, papéis `anon`/`authenticated`): RLS entre dois usuários, upsert mais antigo ignorado, *tombstone* aceito e reexecução do script.

## Situação da publicação
- **HTTPS:** o site abre em `https://anamnesia.net.br`, necessário para a conta funcionar.
- **Supabase:** projeto criado, `supabase-setup.sql` executado e sincronização testada pelo autor entre celular e PC.
- **Novos cadastros desativados** no Supabase ("Allow new users to sign up" desligado), confirmado pelo autor.

## Decisões do autor
- Fotos do encaminhamento (exames de laboratório e imagem): a extração é feita pelo chat com o Claude, não dentro do site.
- Posologias pré-definidas da prescrição: colocadas direto no app, com doses usuais de adulto e referências, todas editáveis.
  - Bromoprida EV: 8 mg 8/8h (definido pelo autor).
  - Esquema de correção de insulina: faixas do RABBIT 2 (confirmado pelo autor).
- Enfermaria: as condutas da admissão ficam só na admissão (não passam para a evolução).
- IC Hemato: manter como está (Mosteller, classificação de risco da leucemia aguda e rótulo "DE"); o autor vai pedir outras mudanças depois.
- Grafia: **"Anamnesia"**, sem acento.
- Manter o web app como está, inclusive a seção Condutas da enfermaria, até o autor pedir mudanças.

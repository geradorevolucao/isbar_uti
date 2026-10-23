# Anamnesia — contexto do projeto

Prontuário eletrônico pessoal ("o prontuário eletrônico que te lembra do que não esquecer") para uso de um médico residente: evoluções de CTI e de enfermaria de clínica médica, um bloco de notas por paciente, além de uma proposta de prescrição para discussão com a preceptoria.

## Preferências do autor (seguir sempre)
- Responder em português do Brasil.
- Seguir exatamente o que for pedido, sem extrapolar conteúdo clínico não solicitado.
- Em qualquer conteúdo médico (campos, fórmulas, condutas), citar a bibliografia usada.
- Não pré-preencher doses ou condutas: o app é um formulário; o conteúdo clínico é do autor. Exceção pedida pelo autor: o catálogo de opções da prescrição (`RX_CAT`), que só entra quando o autor escolhe uma opção, fica sempre editável e tem as referências em `RX_CAT_REFS`.

## Arquitetura
- **Um único arquivo `index.html`** (HTML + CSS + JS inline, sem dependências externas nem CDN). Precisa continuar funcionando offline e aberto direto do disco (`file://`), porque a rede do hospital bloqueia alguns sites.
- **Publicação:** GitHub Pages (usuário `geradorevolucao`, branch `main`, pasta raiz), com domínio próprio `anamnesia.net.br`.
- **`supabase-setup.sql`:** cria as tabelas `records` e `user_keys` com Row Level Security, e um gatilho que recusa gravações mais antigas (comparando `updated_at`) e carimba `server_ts`. Pode ser rodado de novo sem perder dados. `user_keys` só aceita leitura e criação (sem update/delete).

## Visual (tema escolhido pelo autor no painel de design, 23/10/2026)
- Cor principal azul-petróleo (`--accent:#1D4E6E`, igual à anterior), fundo "névoa azul" (`--bg:#EAF0F5`, `--line:#CFDAE4`), fonte Georgia (serifada, do sistema, sem baixar nada), 16 px, cantos de 4 px (`--radius`; todos os retângulos usam a variável, pílulas e círculos não) e densidade compacta (campos com 6 px de espaço interno, 6–8 px entre campos). O modo escuro não mudou.
- **Editor do Anamnesia** (página comum, substitui o painel de design antigo): https://claude.ai/artifact/SmKtbBTkBywaWw4DFgumky. Abas Estrutura do CTI (blocos, campos, tipos, mover campos, seleção que abre campos) e Visual; o autor copia o bloco "Para aplicar" e envia no chat. Ao aplicar, campos com significado novo ganham chave nova (não reaproveitar a chave de um campo renomeado para outra coisa).

## Telas (`body[data-view]`)
1. **Tela inicial** (`#home`): saudação animada com traçado de ECG. Respeita `prefers-reduced-motion`. O botão "Começar" leva à lista.
2. **Meus pacientes** (`list`): adicionar, editar, mudar de módulo e excluir pacientes; filtro por módulo e busca por nome ou leito.
3. **Prontuário** (`chart`): formulário gerado a partir de um esquema declarativo (`CTI`, `ENF`, `NOTA`). "Gerar texto" monta o texto para colar no prontuário oficial.
4. **Prescrição** (`rx`): proposta com itens nas situações Manter, Nova, Alterar ou Suspender, e aprazamento automático a partir da frequência e do 1º horário. Os botões "+ Escolher dieta" e "+ Escolher da lista" abrem o catálogo `RX_CAT` (dieta, sintomáticos, anticoagulação, correção de glicose, antibioticoterapia, anti-hipertensivos, betabloqueadores, estatinas, protetores gástricos, laxativos, diuréticos e antiagregantes), com busca pelo começo das palavras e filtro por categoria; a opção escolhida entra como "Nova", com descrição, dose, via, frequência e observação preenchidas. A impressão leva a marca-d'água "SIMULAÇÃO – NÃO VÁLIDA" e o aviso de que não serve para dispensação. **Manter essa identificação**: a folha não pode ser confundida com uma prescrição real, e não deve usar logotipo do hospital ou do MV.

## Modelos de evolução (objeto `TPL`)
- **`cti`, ISBAR** (estrutura montada pelo autor no editor, aplicada em 23/10/2026):
  - **I:** identificação (sem alergias, que foram para B).
  - **S:** "Lista de problemas ativos" (cards do tipo `problems`, chave `prob`, subtópicos Apresentação, Etiologia e Propedêutica, as mesmas chaves da enfermaria), Contexto (`motivo`), Intercorrências e antimicrobianos (com D e duração); "Evolução da internação" (campo `diary`: registros com dia e texto, "+ Adicionar dia", que já vem com a data de hoje; no texto saem em ordem de data, "dd/mm/aaaa – texto").
  - **B:** comorbidades, medicações de uso contínuo (`meds`), Alergias (Sim/Não; "Quais" = `alergias`) e Social.
  - **A:** blocos Dados vitais (FR do paciente = `fr_pac`), Balanço hídrico (ganhos, perdas, BH 24 h, acumulado, diurese), Medicações em infusão contínua (sedação, analgesia, droga vasoativa e doses), Dispositivos (datas `cvc_dt`, `pai_dt`, SVD Sim/Não e `svd_dt`), Neurológico, Cardiovascular, Respiratório, Gastrointestinal/nutrição (dieta Suspensa/VO/Enteral/Parenteral, última evacuação como data, aspecto, controle glicêmico) e Exames complementares (Laboratoriais = `ec_lab`, destino padrão do Biomega; Imagem; Culturas).
  - **Modo de suporte ventilatório** (`vent_modo`, campo `cond`): VCV, PCV, PSV, CPAP ou CNBF, cada um abre os seus parâmetros (Recomendações brasileiras de ventilação mecânica 2013). Os parâmetros que já existiam usam as mesmas chaves (`vc`, `fr`, `peep`, `fio2`, `ppico`, `pplato`, `cn_l`); driving pressure e complacência só calculam com VCV ou sem modo marcado.
  - **R:** sem mudança.
  - Saíram (os dados antigos continuam guardados nas fichas): diagnósticos ativos (viraram problemas), SOFA/APACHE, evolução global, funcionalidade, procedimentos, antimicrobianos prévios, RASS alvo, dor, despertar, tendência da DVA, lactato/SvcO2/gap, gasometria e P/F, renal/metabólico, laboratório por caixinhas, hematológico, infeccioso (exceto culturas), pele/mobilidade, checklist FAST HUGS BID e família.
  - Migração (`normalizeStore`, marca `cti_v2`): dx1–dx3 → prob_1–3 (se não houver problemas), alergias escritas → Alergias "Sim", dieta zero/enteral/parenteral → Suspensa/Enteral/Parenteral, `vm_modo` escrito VCV/PCV/PSV/CPAP → `vent_modo`.
  - Campos calculados: PAM; Glasgow total (V = T no paciente intubado); peso predito (fórmula ARDSNet); VC em mL/kg de peso predito; driving pressure; complacência; diurese em mL/kg/h.
- **`enf`, Enfermaria de clínica médica:** Lista de problemas, Contexto, HPP, MUC, Evolução diária, Dados vitais, Exame físico, Exames complementares e Condutas. Cada problema tem 4 subtópicos: Apresentação, Etiologia, Propedêutica e Plano de cuidados (campo do tipo `problems`). "Nova evolução do dia" apaga os campos diários e soma 1 ao DIH.
  - **Exames complementares da evolução** (pedido do autor, 20/10/2026): sem a data da coleta e sem as caixinhas de Hb, Leuco, Plaq, Ur, Cr, Na, K e PCR; ficam só "Laboratoriais" (`ec_lab`, destino padrão do "Inserir no prontuário" do Biomega), Imagem e Outros. Os valores antigos dessas caixinhas continuam guardados na ficha, mas não aparecem nem entram no texto.
  - **Condutas da evolução** (pedido do autor, 20/10/2026): campo `cdl` do tipo `outline`, um campo por conduta (3 abertos de início, até 20), com "+ Adicionar conduta" e "+ sub" para subtópicos (até 8 por conduta). No texto: "- Conduta" e, abaixo, "   - subtópico". O texto antigo de `condutas` foi migrado (uma conduta por linha, sem marcadores) e guardado em `condutas_antigo`.
  - **Texto padrão da evolução diária** (texto do autor, 20/10/2026): o campo `evol` tem `std` = "Avalio paciente em leito de enfermaria, alerta, estável e eupneico, sem queixas. Refere boa aceitação da dieta. Diurese presente, sem queixas urinárias. Evacuações presentes, sem alterações." Exame físico (pedido do autor, 20/10/2026): rótulos sem abreviações (Ectoscopia, Aparelho cardiovascular, Aparelho respiratório, Abdome, Extremidades, Neurológico), campos de texto maiores e sem os exemplos em cinza; o exame normal padrão (Porto, *Semiologia Médica*, 8ª ed., 2019; Bates, 13ª ed., 2021; Glasgow por Teasdale e Jennett, 1974) também sem abreviações, com o respiratório no texto do autor ("Sons respiratórios audíveis bilateralmente, sem alterações à ausculta") e TEC menor que 3 segundos (confirmado pelo autor). Esses campos não aparecem como destino do Biomega. O CTI fica para depois (o autor vai alterar).
  - **Gênero do texto padrão** (pedido do autor, 20/10/2026): evolução diária e Ectoscopia têm `std: { M, F }`, escolhido pelo sexo da ficha (sem sexo: masculino). Ao trocar o sexo (no formulário ou em Editar dados do paciente), `swapStdSexo` troca só os textos padrão ainda não editados.
  - **Admissão / Evolução** (campo `enf_mom`, modelo dinâmico `enfModel`). Fichas novas nascem em Admissão (`newData`); fichas sem a marca, anteriores a essa mudança, ficam em Evolução.
  - **Admissão** (modelo do autor, texto por `admText`): Situação (cards com Apresentação, Etiologia, Propedêutica externa, Propedêutica interna e Plano de cuidados; título vazio sai como "Situação a esclarecer"), Contexto, HPP, MUC, Alergias, HF, HSE, Cirurgias prévias, Exames externos (a) Laboratório, b) Imagem) e Condutas em lista com "- ". O texto usa os títulos "| Situação:", "| Contexto:" etc. e não imprime a identificação.
  - As situações usam a mesma chave da lista de problemas (`prob`). Em "Nova evolução do dia" a ficha passa para Evolução: a propedêutica externa e interna é copiada para "Propedêutica" (se vazia) e título vazio vira "Situação a esclarecer". Contexto, HPP (`comorb`), MUC, alergias e cirurgias também são compartilhados.
  - O campo `problems` aceita `subs` (subtópicos), `item` (nome do card) e `itemPh` (exemplo do título).
  - **Impressão:** situações e problemas saem no formato do texto gerado: "1. Título" e uma linha "- Subtópico:" por item, também em branco. Na impressão (inclusive Ctrl+P), `fitProbAreas` faz os subtópicos crescerem até mostrar todo o texto.
- **`nota`, Notas** (substituiu a IC Hemato, a pedido do autor): bloco de notas por paciente, no lugar do invertexto.com. Identificação (nome, leito, data) e um campo grande "Texto" (`nota`) onde se cola a evolução copiada do sistema. O texto gerado é a nota exatamente como foi colada (sem título); o botão é "Copiar / enviar" e abre a mesma janela de copiar, e-mail e código temporário. Sincroniza cifrada com a conta, como os demais prontuários. A lista mostra a 1ª linha da nota. Sem referências (o rodapé some) e sem "Nova evolução". Na impressão, a nota cresce até mostrar todo o texto.
  - Fichas antigas com `tpl: "ic"` passam para `nota` em `normalizeStore` (os campos antigos ficam guardados nos dados).
- Tipos de campo: `text`, `num`, `area`, `date`, `radio`, `check`, `calc`, `pair`, `gcs`, `list`, `problems`, `cond` (seleção que abre campos: `opts` + `sub: { opção: [campos] }`; os campos de cada opção só aparecem com ela marcada; a mesma chave pode estar em mais de uma opção, e os ids ganham o sufixo `__n`; no texto: "Rótulo: opção | Subcampo: valor"), `diary` (registros por dia: `k_i_d` data, `k_i` texto, `k_n`), `outline` (itens `k_i` com subtópicos `k_i_j`; `n` itens, `ns` subtópicos, `min` abertos de início, `item` = nome; `k_n` e `k_i_n` guardam quantos estão abertos). Opções: `def` (valor padrão de um radio), `tl` (rótulo no texto gerado; `""` imprime só o valor), `daily` (apagado na nova evolução), `ph` (exemplo em cinza, não entra no texto), `std` (texto padrão do autor, string ou `{ M, F }` por sexo: `fillStd` o escreve só nos campos vazios do modelo atual, na ficha nova pela janela do paciente, na "Nova evolução do dia", na troca de modelo, como Admissão → Evolução, e em ⋯ → "Preencher com o texto padrão", que só aparece se o modelo tiver `std`; depois é editável e sai no texto como estiver no campo; campo apagado fica vazio até o próximo desses momentos).

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
- **Janela "Exames do Biomega"** (⋯ no prontuário): prontuário (guardado na ficha em `bio_pront`), período (7 a 365 dias) e unidade; busca os pedidos e depois os resultados em lotes de 8 (`BIO_LOTE`); mostra o formato prontuário ou o documento completo (opção de marcar alterados), os avisos e minigráficos de evolução (exames com 2 ou mais datas, com os valores em texto embaixo). "Inserir no prontuário" acrescenta o texto ao campo escolhido (padrão: "a) Laboratório" na admissão, "Laboratoriais" na evolução). Os resultados ficam só na memória da janela.
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
- IC Hemato: retirada por completo e trocada por Notas (um bloco de notas por paciente, pela conta do Anamnesia).
- Grafia: **"Anamnesia"**, sem acento.
- Manter o web app como está, inclusive a seção Condutas da enfermaria, até o autor pedir mudanças.

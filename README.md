# @conasa/n8n-nodes-tess-ai

Community node do n8n para **toda a API REST** da [Tess AI](https://tess.im): agentes (execução, chat no
formato OpenAI, versões, agendamentos, webhooks, arquivos), execuções, arquivos, memórias, artifacts, Digital
Employees e uso/auditoria do workspace.

## Instalação

n8n self-hosted: *Settings* → *Community Nodes* → *Install* → `@conasa/n8n-nodes-tess-ai`.

## Credenciais

Crie uma credencial **Tess AI API**:

| Campo | Onde encontrar |
|---|---|
| API Key | Tess → *Settings* → *API Tokens* |
| Workspace ID | Tess → *Settings* → *Workspace* (número), ou o parâmetro `w=` na URL do app. Obrigatório em todas as chamadas desde 01/09/2026 |
| Base URL | `https://api.tess.im` (padrão) |
| Requests per Second | limite de chamadas por segundo deste token, somando **todos** os workflows e workers (padrão 1, o limite da Tess) |
| **Redis Host** / **Redis Port** | **obrigatórios** — Redis da fila de rate limit (em produção, o mesmo Redis do n8n em queue mode) |
| Redis User / Redis Password | opcionais (ACL / senha do Redis) |
| Redis Database / Redis TLS | opcionais (padrão `0` / desligado) |

O botão **Test** valida tudo, nesta ordem, e diz qual campo corrigir:

1. **Redis**: conecta (AUTH/SELECT), faz `PING` e roda o script Lua da fila (exige Redis 5+ ou compatível).
2. **Tess**: lista um agente (passando pela fila) para validar API Key (403) e Workspace ID (422).

> **Mudança na 0.3.0**: o Redis saiu das variáveis `QUEUE_BULL_REDIS_*` do n8n e passou para a credencial.
> Credenciais criadas antes precisam ser editadas para informar o Redis.

## Limite de requisições (fila global)

A Tess aceita cerca de **1 requisição por segundo por token** e responde `429` acima disso. O n8n não coordena
limites de API entre workflows, então o node mantém uma **fila própria por API Key** (credenciais com o mesmo
token, mesmo em workspaces diferentes, dividem a mesma fila): todas as chamadas — de todos os workflows,
execuções e workers — saem em ordem, no máximo *Requests per Second* por segundo.

- A fila fica no **Redis informado na credencial**. Chave: `n8n-tess:rl:<hash do token>`. Redis Cluster não é
  suportado. Todos os workers que usam a mesma API Key precisam apontar para o mesmo Redis.
- **Sem Redis a execução falha** com `Tess AI rate limit queue unavailable: …` — Redis vazio na credencial, fora
  do ar ou sem responder em 2 s. O node nunca chama a Tess fora da fila.
- **Teste local**: o painel da central sobe o n8n local; o Redis local é o Memurai em `127.0.0.1:6379`
  (veja `docs/04-testes.md` da central).
- Se mesmo assim vier `429`, o node espera o `retry_after` informado pela Tess e tenta de novo (até 3 vezes).
- Enquanto espera um agente, um run ou um arquivo, o intervalo de consulta cresce até 15 s para gastar menos da
  cota. **Stream Response** (Agent → Execute) evita o polling: uma chamada só por execução.

> Este pacote usa `node:net` para falar com o Redis, por isso é publicado **sem** "cloud support" do n8n (vale
> para self-hosted; não é elegível à verificação para o n8n Cloud).

### Erros: de onde veio

Todo erro diz a **origem** na primeira linha da descrição, para separar problema da Tess de problema do node:

| Source | Significa | Mensagem |
|---|---|---|
| `Tess API (HTTP xxx)` | a Tess respondeu com erro | **exatamente o texto da Tess** (`Tess API error 403: You do not have permission…`) |
| `Tess API — … Tess reported this result` | a chamada deu certo, mas a Tess devolveu falha (ex.: execução `failed`) | o status e o erro informados pela Tess |
| `Network` | não houve resposta (conexão caiu, DNS, proxy, certificado) | `No response from Tess (ECONNRESET): …` |
| `Tess AI node` | o próprio node barrou (parâmetro inválido, Redis/fila, tempo limite) | o motivo |

A descrição traz ainda `Request:` (método + endpoint), `Correlation ID` (quando a Tess envia), `Tess response:`
com o **corpo bruto** da resposta e, separado, um `Node hint:` com a interpretação do node. Cada falha também vai
para o log do n8n (`n8n.log`) em JSON: `source`, `request`, `status`, `tessMessage`, `tessResponse`.
Com *Continue On Fail*, o item de erro traz `error`, `source` e `description`.

Leituras (GET) que perdem a conexão são repetidas até 2 vezes; envios (POST/PUT/DELETE) não, para não duplicar
a ação.

## Operações

| Recurso | Operações |
|---|---|
| **Account** | Get Current User (`/me`: nome, e-mail, créditos); Get Workspace Usage; Get Mission Control Usage (métricas, agrupamentos, comparação); Get Audit Events (janela de até 30 dias) |
| **Agent** | **Execute** (roda o agente; polling ou *Stream Response*); **Chat Completion (OpenAI Compatible)**; Get; Get Many; Link Files; List Files; Unlink File |
| **Agent Response** | Get (status/saída de uma execução); Get Many (filtros por agente, conversa, busca) |
| **Agent Scheduler** | Create (cron ou execução única); Get; Get Many (todos ou de um agente); Update; Delete; Delete by Conversation |
| **Agent Version** | Get; Get Many; Rollback |
| **Artifact** | Create; Get; Get Many; Rename; Edit (operações de patch); Publish Version; Unpublish; Restore Version; Share or Unshare; Get Versions; Delete Version; Delete; Get Templates |
| **Digital Employee** | Create Standalone; Create From Agent; Get; Get Many; Update; Update Goal; Duplicate; Delete; **Invoke** (com *Wait for Completion*: acompanha o run e devolve o output); Pause; Resume; Preview Schedule; Get Rollback Options; Rollback; Reparent; Detach From Parent; Get Activity; Get Files; Get Capabilities; Approve / Reject Hire Request; Upload Avatar |
| **Digital Employee Run** | Get; Get Many; Get Output; Get Summary; Retry; Watch (Stream) |
| **Digital Employee Template** | Export; Preview Import; Import |
| **File** | Upload (até 200 MB; processa e espera ficar pronto, opcional); Get; Get Many; Process (sync/async); Delete; Update Visibility; Resolve Reference (`doc://` → URL temporária) |
| **Memory** | Create; Update; Delete; Get Many (por coleção); Import From Text; Get Import Status |
| **Memory Collection** | Create; Update (renomear); Delete (apaga também as memórias; a coleção padrão não pode ser apagada); Get Many; Get IDs |
| **Webhook** | Create (por agente); Get Many (todos ou de um agente); Delete |

Convenções em todos os recursos:

- **Get Many** tem *Return All* / *Limit* e pagina sozinho conforme o endpoint (página, cursor ou offset).
- Campos opcionais ficam em *Additional Fields* / *Update Fields*. Onde a API aceita estruturas livres há
  **Additional Body (JSON)**, mesclado no corpo — serve para campos novos da Tess que o node ainda não lista.
- Agente, Digital Employee e Artifact podem ser escolhidos da lista (com busca) ou por ID.

Upload: até 32 MB vai direto (`POST /files`); de 32 MB a 200 MB usa o fluxo v2 da Tess (URL assinada →
envio direto ao storage → registro), automaticamente. O tamanho é conferido pelos metadados antes de carregar o
arquivo. *Wait for Processing* acompanha o status até `completed`; se a Tess devolver um status desconhecido, o
node para de esperar (com aviso no log) em vez de ficar preso.

**Versões do node**: workflows criados até a 0.2.x usam o node v1, em que *Wait for Processing* começa
desligado (mesmo comportamento de antes). Nodes novos são v1.1, com *Wait for Processing* ligado por padrão.

### Agent → Execute

- **Agent**: escolha da lista (busca por nome), por ID ou pela URL do agente.
- **Message**: mensagem do usuário (agentes de chat). Vira `messages: [{ role: "user", content }]`.
- **Agent Inputs**: os campos que o agente define (ex.: "nome-da-empresa", "max_mode") são carregados
  automaticamente depois de escolher o agente, já com o tipo certo (texto, número, sim/não, lista).
  `model`, `tools` e `temperature` ficam em *Options* como listas.
- **Wait for Completion** (padrão: ligado): a Tess responde em até 100 s; se a execução continuar, o node consulta
  `/agent-responses/{id}` a cada *Poll Interval* até terminar ou atingir o *Timeout* (padrão 600 s;
  **0 = sem limite**, vale só o timeout de execução do n8n, se houver). O *Timeout* é **um prazo único para a
  operação inteira**: processamento dos anexos + execução do agente + correções de JSON.
  Desligado, devolve o ID da execução na hora — consulte depois com *Agent Response → Get*.
- **Stream Response** (*Options*, só agentes de chat): pede a resposta em stream (SSE) e junta os pedaços —
  uma chamada só, sem polling. A saída tem o mesmo formato, com `streamed: true`.
- **Output Format → JSON** (a API da Tess não tem "modo JSON"; o node garante o formato):
  - **Schema Type** — igual ao *Structured Output Parser* do n8n:
    - **Generate From JSON Example** (*JSON Example*): gera o schema a partir de um exemplo — todas as chaves
      obrigatórias, nenhuma a mais, tipos pelos valores (`true` = boolean, `0` = número, `"texto"` = string; também
      aceita `"boolean"`, `"number"`, `"integer"`, `"string"` como nome do tipo; `null` = qualquer tipo).
    - **Define Using JSON Schema** (*Input Schema*): [JSON Schema](https://json-schema.org) completo. Suporta
      `type` (inclusive `["string","null"]`), `properties`, `required`, `additionalProperties`, `items` (lista e
      tupla), `enum`, `const`, `anyOf`/`oneOf`/`allOf`, `$ref` local (`$defs`/`definitions`), `nullable`,
      `minLength`/`maxLength`, `pattern`, `format` (date, date-time, time, email, uri, uuid),
      `minimum`/`maximum`/`exclusive*`, `multipleOf`, `minItems`/`maxItems`.
      **Propriedade não declarada é rejeitada**, a menos que o schema diga `"additionalProperties": true`.
  - O schema (e o exemplo, no modo exemplo) vai ao agente como **mensagens anteriores** (instrução do usuário +
    confirmação do assistente) e *Message* vem por último.
  - Na resposta, o node extrai o JSON (aceita ` ```json `, texto antes/depois) e valida contra o schema:
    - `"true"`/`"false"` → boolean, `"8"` → número/inteiro, número/boolean → texto, `"null"` → null (onde
      permitido), valor de `enum` com tipo trocado → **corrigido no node**, sem reenviar (lista em `json_fixes`);
    - **propriedade não solicitada**, obrigatória faltando, fora do `enum`/limites/formato ou tipo impossível de
      converter → pede a correção **na mesma conversa** (`root_id`) até *Correction Attempts* vezes;
    - ainda inválido → **o node falha** listando cada problema com o caminho (ex.: `$.riscos[0].peso is missing`).

  Saída: `output_json` (JSON validado e convertido), `output` (texto original), `json_attempts`, `json_fixes` e
  `credits` somados de todas as tentativas.
- **Options**:
  - **Model**, **Tool** e **Temperature**: listas com os valores que o agente escolhido permite (vazio = padrão do
    agente). Só uma ferramenta por execução.
  - **Continue Conversation (Root ID)**: continua uma conversa que a Tess já guardou — use o `root_id` devolvido
    por uma execução anterior. É o jeito mais simples de manter contexto.
  - **Previous Messages** / **Previous Messages (JSON)**: só quando o histórico está fora da Tess (ex.: um chat
    guardado em outro sistema). As mensagens vão antes de *Message*. A versão JSON aceita uma expressão que
    devolve a lista `[{ "role": "user"|"assistant", "content": "..." }]`.
  - **Attachments (Binary Fields)**: nomes dos campos binários do item (ex.: `data, data_1`). Cada arquivo é
    enviado (até 200 MB), processado e anexado à execução — sem nodes de File separados. A saída ganha
    `uploaded_files`.
  - File IDs (arquivos já enviados; somam com os anexos), Memory Collection IDs, Poll Interval, Timeout.

Saída: o objeto da execução (`id`, `status`, `output`, `credits`, `root_id`, `generated_files`…) + `agent_id`.
Execução que não termina com `succeeded`/`completed` gera erro (use *Continue On Fail* para tratar no fluxo).

### Agent → Chat Completion (OpenAI Compatible)

Envia *Messages* (System/User/Assistant) para `POST /agents/{id}/openai/chat/completions`, no formato da API de
Chat Completions da OpenAI. *Simplify* (padrão) devolve só `content`, `finish_reason`, `usage` e `model`;
desligado, devolve a resposta completa. Modelo = slug da API (ex.: `tess-6`), entre os permitidos pelo agente.

### MCP

A Tess também expõe um **MCP Server** (docs: *MCP Server (API)*). Ele não faz parte deste node: no n8n, use o node
nativo **MCP Client Tool** apontando para o endpoint MCP da Tess quando quiser que um AI Agent use as
ferramentas da Tess diretamente.

### Exemplo: analisar um PDF

```
Read Binary File → Tess AI (Agent → Execute, Options → Attachments = data)
```

### Uso como ferramenta de AI Agent

O node tem `usableAsTool`: pode ser ligado como *tool* de um AI Agent do n8n (exige
`N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` no n8n).

## Compatibilidade

Desenvolvido para n8n 2.41.x (Node.js 24).

Alguns corpos de requisição não estão documentados por completo na Tess e foram modelados a partir das
ferramentas MCP oficiais: **Memory → Import From Text** envia `{ text, collection_id }` e **File → Process**
envia `mode` na query. Se a Tess rejeitar o Import, ajuste com *Additional Body (JSON)*; nos dois casos, abra uma
issue para corrigirmos o node.

## Testes

```
npm test          # vitest: todas as operações, paginação, streams, espera de runs
```

Os testes de integração da fila rodam contra um Redis em `127.0.0.1:6379` (ou `TESS_TEST_REDIS_HOST` /
`TESS_TEST_REDIS_PORT`) e são pulados quando não há Redis.

## Recursos

- [Documentação da API da Tess](https://docs.tess.im/en/api-overview)
- [Community nodes do n8n](https://docs.n8n.io/integrations/#community-nodes)

## Histórico de versões

Ver [CHANGELOG.md](CHANGELOG.md).

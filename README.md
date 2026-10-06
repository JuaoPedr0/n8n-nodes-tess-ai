# @conasa/n8n-nodes-tess-ai

Community node do n8n para a API da [Tess AI](https://tess.im): executar agentes, consultar execuções, enviar
arquivos e gerenciar memórias.

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

O botão **Test** lista um agente para validar token e workspace.

## Limite de requisições (fila global)

A Tess aceita cerca de **1 requisição por segundo por token** e responde `429` acima disso. O n8n não coordena
limites de API entre workflows, então o node mantém uma **fila própria por API Key** (credenciais com o mesmo
token, mesmo em workspaces diferentes, dividem a mesma fila): todas as chamadas — de todos os workflows e
execuções — saem em ordem, no máximo *Requests per Second* por segundo.

- A fila fica **sempre no Redis da infraestrutura do n8n**, lido das variáveis que o n8n já usa:
  `QUEUE_BULL_REDIS_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD`, `_DB`, `_TLS` (inclusive as variantes `_FILE`).
  Chave: `n8n-tess:rl:<hash do token>`. Redis Cluster não é suportado.
- **Sem Redis a execução falha** com `Tess AI rate limit queue unavailable: …` — Redis não configurado, fora do
  ar ou sem responder em 2 s. O node nunca chama a Tess fora da fila.
- **n8n local de desenvolvimento**: o painel da central passa ao n8n local as variáveis do Redis da infra,
  configuradas em `central.local.json` (fora do git; modelo em `central.local.example.json`).
- Se mesmo assim vier `429`, o node espera o `retry_after` informado pela Tess e tenta de novo (até 3 vezes).
- Enquanto espera um agente ou um arquivo, o intervalo de consulta cresce até 15 s para gastar menos da cota.

> Este pacote usa `node:net`/`process.env` para falar com o Redis, por isso é publicado **sem** "cloud support"
> do n8n (vale para self-hosted; não é elegível à verificação para o n8n Cloud).

Erros comuns viram mensagens diretas: API Key inválida (401/403), Workspace ID ausente (422), ID não encontrado
(404), arquivo grande demais (413), limite da Tess (429).

## Operações

| Recurso | Operações |
|---|---|
| **Agent** | **Execute** — roda o agente e devolve a resposta; **Get**; **Get Many**; **Link Files** (arquivos como base de conhecimento) |
| **Agent Response** | **Get** — status/saída de uma execução; **Get Many** (filtros por agente, conversa, busca) |
| **File** | **Upload** (até 200 MB; processa e espera ficar pronto, opcional); **Get**; **Get Many**; **Process** |
| **Memory** | **Create**; **Update**; **Delete**; **Get Many** (por coleção) |
| **Memory Collection** | **Create**; **Update** (renomear); **Delete** (apaga também as memórias; a coleção padrão não pode ser apagada); **Get Many** |

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
  `model`, `tools` e `temperature` ficam em *Options* como listas; `stream` não aparece (o node sempre espera a
  resposta completa).
- **Wait for Completion** (padrão: ligado): a Tess responde em até 100 s; se a execução continuar, o node consulta
  `/agent-responses/{id}` a cada *Poll Interval* até terminar ou atingir o *Timeout* (padrão 600 s;
  **0 = sem limite**, vale só o timeout de execução do n8n, se houver). O *Timeout* é **um prazo único para a
  operação inteira**: processamento dos anexos + execução do agente + correções de JSON.
  Desligado, devolve o ID da execução na hora — consulte depois com *Agent Response → Get*.
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
Execução com status diferente de `succeeded` gera erro (use *Continue On Fail* para tratar no fluxo).

### Exemplo: analisar um PDF

```
Read Binary File → Tess AI (Agent → Execute, Options → Attachments = data)
```

### Uso como ferramenta de AI Agent

O node tem `usableAsTool`: pode ser ligado como *tool* de um AI Agent do n8n (exige
`N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` no n8n).

## Compatibilidade

Desenvolvido para n8n 2.41.x (Node.js 24).

## Recursos

- [Documentação da API da Tess](https://docs.tess.im/en/api-overview)
- [Community nodes do n8n](https://docs.n8n.io/integrations/#community-nodes)

## Histórico de versões

Ver [CHANGELOG.md](CHANGELOG.md).

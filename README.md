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

O botão **Test** lista um agente para validar token e workspace.

## Operações

| Recurso | Operações |
|---|---|
| **Agent** | **Execute** — roda o agente e devolve a resposta; **Get**; **Get Many**; **Link Files** (arquivos como base de conhecimento) |
| **Agent Response** | **Get** — status/saída de uma execução; **Get Many** (filtros por agente, conversa, busca) |
| **File** | **Upload** (até 32 MB, com processamento opcional); **Get**; **Get Many**; **Process** |
| **Memory** | **Create**; **Get Many** (por coleção) |
| **Memory Collection** | **Get Many** |

### Agent → Execute

- **Agent**: escolha da lista (busca por nome), por ID ou pela URL do agente.
- **Message**: mensagem do usuário (agentes de chat). Vira `messages: [{ role: "user", content }]`.
- **Agent Inputs**: os campos que o agente define (ex.: "nome-da-empresa", "max_mode") são carregados
  automaticamente depois de escolher o agente, já com o tipo certo (texto, número, sim/não, lista).
  `model`, `tools` e `temperature` ficam em *Options* como listas; `stream` não aparece (o node sempre espera a
  resposta completa).
- **Wait for Completion** (padrão: ligado): a Tess responde em até 100 s; se a execução continuar, o node consulta
  `/agent-responses/{id}` a cada *Poll Interval* até terminar ou atingir o *Timeout* (padrão 600 s;
  **0 = sem limite**, vale só o timeout de execução do n8n, se houver).
  Desligado, devolve o ID da execução na hora — consulte depois com *Agent Response → Get*.
- **Output Format → JSON** (a API da Tess não tem "modo JSON"; o node garante o formato):
  - **Response DTO** (obrigatório): a estrutura exata da resposta. Os valores definem os tipos —
    `true` = boolean, `0` = número, `"texto"` = string (ou escreva `"boolean"`, `"number"`, `"string"`);
    `null` = qualquer tipo; um array com 1 item define o formato de todos os itens. Ex.:
    `{ "aprovado": true, "nota": 0, "resumo": "texto", "riscos": [{ "titulo": "texto", "nivel": "alto" }] }`
  - O DTO vai ao agente como **mensagens anteriores** (instrução do usuário + confirmação do assistente) e
    *Message* vem por último.
  - Na resposta, o node extrai o JSON (aceita ` ```json `, texto antes/depois) e valida contra o DTO:
    - `"true"`/`"false"` → boolean, `"8"` → número, número/boolean → texto: **corrigido no node**, sem reenviar
      (lista em `json_fixes`);
    - **campo não solicitado**, campo faltando ou tipo impossível de converter → pede a correção **na mesma
      conversa** (`root_id`) até *Correction Attempts* vezes;
    - ainda inválido → **o node falha** listando os problemas (ou devolve `error` com *Continue On Fail*).
  - `null` é aceito em qualquer campo.

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
  - File IDs, Memory Collection IDs, Poll Interval, Timeout.

Saída: o objeto da execução (`id`, `status`, `output`, `credits`, `root_id`, `generated_files`…) + `agent_id`.
Execução com status diferente de `succeeded` gera erro (use *Continue On Fail* para tratar no fluxo).

### Exemplo: analisar um PDF

```
Read Binary File → Tess AI (File → Upload, Process After Upload) → Tess AI (Agent → Execute, Options → File IDs = {{ $json.id }})
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

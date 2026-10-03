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
- **Agent Inputs**: os campos que o agente define (ex.: "nome-da-empresa", "language") são carregados
  automaticamente depois de escolher o agente.
- **Wait for Completion** (padrão: ligado): a Tess responde em até 100 s; se a execução continuar, o node consulta
  `/agent-responses/{id}` a cada *Poll Interval* até terminar ou atingir o *Timeout* (padrão 600 s).
  Desligado, devolve o ID da execução na hora — consulte depois com *Agent Response → Get*.
- **Options**: Chat History (JSON no formato OpenAI), Continue Conversation (`root_id` de uma execução anterior),
  File IDs, Memory Collection IDs, Model, Temperature, Tools.

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

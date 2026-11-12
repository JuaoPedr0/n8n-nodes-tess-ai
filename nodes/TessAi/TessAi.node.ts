import type {
	FieldType,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';
import { jsonParse, NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { accountHandlers } from './actions/account';
import { agentSchedulerHandlers, agentVersionHandlers, webhookHandlers } from './actions/agentAdmin';
import { artifactHandlers } from './actions/artifact';
import type { HandlerMap } from './actions/common';
import { itemsOf } from './actions/common';
import {
	digitalEmployeeHandlers,
	digitalEmployeeRunHandlers,
	digitalEmployeeTemplateHandlers,
} from './actions/digitalEmployee';
import { accountFields, accountOperations } from './descriptions/AccountDescription';
import { agentFields, agentOperations } from './descriptions/AgentDescription';
import {
	agentSchedulerFields,
	agentSchedulerOperations,
} from './descriptions/AgentSchedulerDescription';
import { agentVersionFields, agentVersionOperations } from './descriptions/AgentVersionDescription';
import { artifactFields, artifactOperations } from './descriptions/ArtifactDescription';
import {
	digitalEmployeeFields,
	digitalEmployeeOperations,
	digitalEmployeeRunFields,
	digitalEmployeeRunOperations,
	digitalEmployeeTemplateFields,
	digitalEmployeeTemplateOperations,
} from './descriptions/DigitalEmployeeDescription';
import { webhookFields, webhookOperations } from './descriptions/WebhookDescription';
import {
	agentResponseFields,
	agentResponseOperations,
} from './descriptions/AgentResponseDescription';
import { fileFields, fileOperations } from './descriptions/FileDescription';
import {
	memoryCollectionFields,
	memoryCollectionOperations,
	memoryFields,
	memoryImportFields,
	memoryOperations,
} from './descriptions/MemoryDescription';
import {
	buildSchema,
	correctionMessage,
	extractJson,
	instructionMessages,
	validateSchema,
} from './JsonOutput';
import type { JsonSchema } from './JsonOutput';
import { agentExtraHandlers, streamAgentExecution } from './actions/agent';
import {
	fileExtraHandlers,
	memoryCollectionExtraHandlers,
	memoryExtraHandlers,
} from './actions/fileMemory';
import { tessAiApiTest } from './CredentialTest';
import {
	AGENT_SUCCEEDED,
	parseIdList,
	tessApiRequest,
	tessApiRequestAllItems,
	deadlineFrom,
	uploadBinary,
	waitForAgentResponse,
} from './GenericFunctions';

// campos do agente que o node expõe em "Options" ou controla sozinho (não aparecem em "Agent Inputs").
// "stream" fica de fora: o node sempre espera a resposta completa.
const RESERVED_INPUTS = [
	'messages',
	'root_id',
	'temperature',
	'model',
	'tools',
	'file_ids',
	'memory_collections',
	'waitExecution',
	'stream',
];

// recursos novos: despacho por mapa (operation -> handler); os 5 originais seguem nas funcoes executeX
const RESOURCE_HANDLERS: Record<string, HandlerMap> = {
	account: accountHandlers,
	agentScheduler: agentSchedulerHandlers,
	agentVersion: agentVersionHandlers,
	artifact: artifactHandlers,
	digitalEmployee: digitalEmployeeHandlers,
	digitalEmployeeRun: digitalEmployeeRunHandlers,
	digitalEmployeeTemplate: digitalEmployeeTemplateHandlers,
	webhook: webhookHandlers,
};

// quando o agente não define temperaturas permitidas
const DEFAULT_TEMPERATURES = ['0', '0.25', '0.5', '0.75', '1'];

interface AgentQuestion {
	name: string;
	type?: string;
	description?: string | null;
	required?: boolean;
	options?: string[];
	default?: unknown;
}

async function getAgentQuestions(this: ILoadOptionsFunctions): Promise<AgentQuestion[]> {
	const agentId = this.getNodeParameter('agent', undefined, { extractValue: true }) as string;
	if (!agentId || !/^[0-9]+$/.test(String(agentId))) return [];
	const agent = (await tessApiRequest.call(this, 'GET', `/agents/${agentId}`)) as IDataObject;
	return ((agent.questions as AgentQuestion[] | undefined) ?? []).filter((q) => q?.name);
}

/** Opções de um campo "select" do agente (model, tools, temperature) + "padrão do agente". */
async function agentSelectOptions(
	this: ILoadOptionsFunctions,
	questionName: string,
	fallback: string[] = [],
): Promise<INodePropertyOptions[]> {
	const question = (await getAgentQuestions.call(this)).find((q) => q.name === questionName);
	const values = question?.options?.length ? question.options : fallback;
	const label = questionName === 'temperature' ? temperatureLabel : (v: string) => v;
	return [
		{ name: 'Agent Default', value: '' },
		...values.map((v) => ({ name: label(String(v)), value: String(v) })),
	];
}

function temperatureLabel(value: string): string {
	const n = Number(value);
	if (Number.isNaN(n)) return value;
	const style =
		n <= 0
			? 'Most objective'
			: n <= 0.3
				? 'Objective'
				: n <= 0.6
					? 'Balanced'
					: n <= 0.85
						? 'Creative'
						: 'Most creative';
	return `${value} — ${style}`;
}

function fieldTypeOf(q: AgentQuestion): FieldType {
	if (q.type === 'select' && q.options?.length) return 'options';
	if (q.type === 'number') return 'number';
	if (q.type === 'boolean') return 'boolean';
	if (q.type === 'array') return 'array';
	if (q.type === 'object') return 'object';
	return 'string';
}

export class TessAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tess AI',
		name: 'tessAi',
		icon: {
			light: 'file:../../icons/tess-ai-logo.svg',
			dark: 'file:../../icons/tess-ai-logo.dark.svg',
		},
		group: ['transform'],
		version: [1, 1.1],
		defaultVersion: 1.1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Run Tess AI agents and manage files, memories, schedulers, webhooks, artifacts and digital employees',
		defaults: { name: 'Tess AI' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'tessAiApi', required: true, testedBy: 'tessAiApiTest' }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Agent', value: 'agent' },
					{ name: 'Agent Response', value: 'agentResponse' },
					{ name: 'Agent Scheduler', value: 'agentScheduler' },
					{ name: 'Agent Version', value: 'agentVersion' },
					{ name: 'Artifact', value: 'artifact' },
					{ name: 'Digital Employee', value: 'digitalEmployee' },
					{ name: 'Digital Employee Run', value: 'digitalEmployeeRun' },
					{ name: 'Digital Employee Template', value: 'digitalEmployeeTemplate' },
					{ name: 'File', value: 'file' },
					{ name: 'Memory', value: 'memory' },
					{ name: 'Memory Collection', value: 'memoryCollection' },
					{ name: 'Webhook', value: 'webhook' },
				],
				default: 'agent',
			},
			...agentOperations,
			...agentFields,
			...agentResponseOperations,
			...agentResponseFields,
			...fileOperations,
			...fileFields,
			...memoryOperations,
			...memoryFields,
			...memoryImportFields,
			...memoryCollectionOperations,
			...memoryCollectionFields,
			...accountOperations,
			...accountFields,
			...agentSchedulerOperations,
			...agentSchedulerFields,
			...agentVersionOperations,
			...agentVersionFields,
			...artifactOperations,
			...artifactFields,
			...digitalEmployeeOperations,
			...digitalEmployeeFields,
			...digitalEmployeeRunOperations,
			...digitalEmployeeRunFields,
			...digitalEmployeeTemplateOperations,
			...digitalEmployeeTemplateFields,
			...webhookOperations,
			...webhookFields,
		],
	};

	methods = {
		credentialTest: { tessAiApiTest },

		listSearch: {
			async searchAgents(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const page = Number(paginationToken) || 1;
				const response = (await tessApiRequest.call(this, 'GET', '/agents', undefined, {
					page,
					per_page: 50,
					...(filter ? { q: filter } : {}),
				})) as IDataObject;
				const agents = (response.data as IDataObject[] | undefined) ?? [];
				const lastPage = Number(response.last_page ?? page);
				return {
					results: agents.map((agent) => ({
						name: `${agent.title} (#${agent.id})`,
						value: String(agent.id),
					})),
					paginationToken: page < lastPage ? String(page + 1) : undefined,
				};
			},

			async searchDigitalEmployees(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const page = Number(paginationToken) || 1;
				const response = (await tessApiRequest.call(this, 'GET', '/digital-employees', undefined, {
					page,
					per_page: 50,
				})) as IDataObject;
				const employees = itemsOf(response, ['employees', 'data.employees']);
				const term = String(filter ?? '').toLowerCase();
				const meta = (response.meta as IDataObject | undefined) ?? {};
				const lastPage = Number(response.last_page ?? meta.last_page ?? page);
				return {
					results: employees
						.filter((e) => !term || String(e.name ?? '').toLowerCase().includes(term))
						.map((e) => ({ name: `${e.name ?? 'Employee'} (#${e.id})`, value: String(e.id) })),
					paginationToken: page < lastPage ? String(page + 1) : undefined,
				};
			},

			async searchArtifacts(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const response = (await tessApiRequest.call(this, 'GET', '/artifacts', undefined, {
					per_page: 50,
					...(paginationToken ? { cursor: paginationToken } : {}),
				})) as IDataObject;
				const artifacts = itemsOf(response);
				const term = String(filter ?? '').toLowerCase();
				const meta = (response.meta as IDataObject | undefined) ?? {};
				return {
					results: artifacts
						.filter((a) => !term || String(a.title ?? '').toLowerCase().includes(term))
						.map((a) => ({
							name: String(a.title ?? a.universal_id),
							value: String(a.universal_id ?? a.id),
						})),
					paginationToken: meta.has_more && meta.next_cursor ? String(meta.next_cursor) : undefined,
				};
			},
		},

		loadOptions: {
			async getMemoryCollections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const collections = await tessApiRequestAllItems.call(
					this,
					'/memory-collections',
					'collections',
				);
				return collections.map((c) => ({
					name: String(c.display_name || c.name || c.id),
					value: c.id as number,
				}));
			},

			async getArtifactTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = (await tessApiRequest.call(this, 'GET', '/artifact-templates')) as IDataObject;
				return itemsOf(response, ['templates']).map((t) => ({
					name: String(t.name ?? t.title ?? t.slug),
					value: String(t.slug ?? t.id),
					description: t.description ? String(t.description) : undefined,
				}));
			},

			async getAgentModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await agentSelectOptions.call(this, 'model');
			},

			async getAgentTools(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await agentSelectOptions.call(this, 'tools');
			},

			async getAgentTemperatures(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await agentSelectOptions.call(this, 'temperature', DEFAULT_TEMPERATURES);
			},
		},

		resourceMapping: {
			async getAgentInputs(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const questions = (await getAgentQuestions.call(this)).filter(
					(q) => !RESERVED_INPUTS.includes(q.name),
				);

				const fields: ResourceMapperField[] = questions.map((q) => {
					const type = fieldTypeOf(q);
					return {
						id: q.name,
						displayName: q.description ? `${q.name} (${q.description})` : q.name,
						required: Boolean(q.required),
						defaultMatch: false,
						canBeUsedToMatch: false,
						display: true,
						type,
						...(type === 'options'
							? { options: q.options!.map((o) => ({ name: String(o), value: String(o) })) }
							: {}),
					};
				});

				return { fields };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let result: IDataObject | IDataObject[];

				if (resource === 'agent') {
					result = await executeAgent.call(this, operation, i);
				} else if (resource === 'agentResponse') {
					result = await executeAgentResponse.call(this, operation, i);
				} else if (resource === 'file') {
					result = await executeFile.call(this, operation, i);
				} else if (resource === 'memory') {
					result = await executeMemory.call(this, operation, i);
				} else if (resource === 'memoryCollection') {
					result = await executeMemoryCollection.call(this, operation, i);
				} else if (RESOURCE_HANDLERS[resource]) {
					const handler = RESOURCE_HANDLERS[resource][operation];
					if (!handler) {
						throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
							itemIndex: i,
						});
					}
					result = await handler.call(this, i);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, {
						itemIndex: i,
					});
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(result),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					const description = (error as { description?: unknown }).description;
					returnData.push({
						json: {
							error: (error as Error).message,
							...(description ? { description: String(description) } : {}),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				// re-embrulhar um NodeApiError/NodeOperationError devolve o proprio erro; so marcamos o item
				if (
					(error instanceof NodeApiError || error instanceof NodeOperationError) &&
					error.context
				) {
					error.context.itemIndex ??= i;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

// ---------------------------------------------------------------------------

function cleanQuery(qs: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(qs).filter(([, v]) => v !== undefined && v !== '' && v !== 0),
	);
}

async function getMany(
	this: IExecuteFunctions,
	i: number,
	endpoint: string,
	dataKey: string,
	qs: IDataObject = {},
	perPage = 50,
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
	return await tessApiRequestAllItems.call(this, endpoint, dataKey, cleanQuery(qs), {
		limit,
		perPage,
	});
}

async function executeAgent(this: IExecuteFunctions, operation: string, i: number) {
	if (operation === 'getMany') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		return await getMany.call(this, i, '/agents', 'data', filters);
	}
	if (agentExtraHandlers[operation]) return await agentExtraHandlers[operation].call(this, i);

	const agentId = this.getNodeParameter('agent', i, '', { extractValue: true }) as string;
	if (!/^[0-9]+$/.test(String(agentId))) {
		throw new NodeOperationError(this.getNode(), `Invalid agent ID: "${agentId}"`, {
			itemIndex: i,
		});
	}

	if (operation === 'get') {
		return (await tessApiRequest.call(this, 'GET', `/agents/${agentId}`)) as IDataObject;
	}

	if (operation === 'linkFiles') {
		const fileIds = parseIdList(this.getNodeParameter('fileIds', i));
		if (!fileIds.length)
			throw new NodeOperationError(this.getNode(), 'Inform at least one file ID', { itemIndex: i });
		return (await tessApiRequest.call(this, 'POST', `/agents/${agentId}/files`, {
			file_ids: fileIds,
		})) as IDataObject;
	}

	if (operation === 'execute') {
		const message = this.getNodeParameter('message', i, '') as string;
		const inputs = (this.getNodeParameter('inputs.value', i, {}) as IDataObject | null) ?? {};
		const wait = this.getNodeParameter('waitForCompletion', i, true) as boolean;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		// um único prazo para a operação inteira: anexos + execução + correções de JSON (0 = sem limite)
		const timeoutSeconds = (options.timeout as number) ?? 600;
		const deadline = deadlineFrom(timeoutSeconds);

		const body: IDataObject = {};
		for (const [key, value] of Object.entries(inputs)) {
			if (value !== null && value !== undefined && value !== '') body[key] = value;
		}

		// histórico (lista ou JSON) + mensagem atual
		const messages: IDataObject[] = [];
		const history = ((options.history as IDataObject | undefined)?.messages as IDataObject[]) ?? [];
		for (const m of history) {
			if (String(m.content ?? '').trim())
				messages.push({ role: m.role ?? 'user', content: m.content });
		}
		if (options.messages !== undefined && options.messages !== '' && options.messages !== '[]') {
			const parsed =
				typeof options.messages === 'string'
					? jsonParse<unknown>(options.messages)
					: options.messages;
			if (!Array.isArray(parsed)) {
				throw new NodeOperationError(
					this.getNode(),
					'"Previous Messages (JSON)" must be a JSON array',
					{ itemIndex: i },
				);
			}
			messages.push(...(parsed as IDataObject[]));
		}
		// Saída em JSON: o DTO é obrigatório e vai como instrução (mensagens anteriores à mensagem atual)
		const outputFormat = wait
			? (this.getNodeParameter('outputFormat', i, 'text') as string)
			: 'text';
		let schema: JsonSchema = {};
		if (outputFormat === 'json') {
			try {
				// lê só o campo visível do modo escolhido
				const schemaType = this.getNodeParameter('schemaType', i, 'fromJson') as string;
				const built = buildSchema(
					schemaType,
					schemaType === 'fromJson' ? this.getNodeParameter('jsonSchemaExample', i, '') : undefined,
					schemaType === 'manual' ? this.getNodeParameter('inputSchema', i, '') : undefined,
				);
				schema = built.schema;
				messages.push(...instructionMessages(schema, built.example));
			} catch (error) {
				throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: i });
			}
		}

		if (message.trim()) messages.push({ role: 'user', content: message });
		if (messages.length) body.messages = messages;

		if (options.model) body.model = options.model;
		if (options.temperature !== undefined && options.temperature !== '') {
			body.temperature = String(options.temperature);
		}
		if (options.tools) body.tools = options.tools;
		if (options.rootId) body.root_id = options.rootId;
		// anexos: binários do item → upload + processamento → file_ids (junto com "File IDs")
		const uploadedFiles: IDataObject[] = [];
		const binaryFields = String(options.attachments ?? '')
			.split(',')
			.map((f) => f.trim())
			.filter(Boolean);
		for (const field of binaryFields) {
			const file = await uploadBinary.call(this, i, field, {
				process: true,
				waitForProcessing: true,
				deadline,
				timeoutSeconds,
			});
			uploadedFiles.push({
				id: file.id,
				filename: file.filename,
				bytes: file.bytes,
				status: file.status,
			});
		}
		const fileIds = [...uploadedFiles.map((f) => Number(f.id)), ...parseIdList(options.fileIds)];
		if (fileIds.length) body.file_ids = fileIds;
		const extra: IDataObject = uploadedFiles.length ? { uploaded_files: uploadedFiles } : {};
		const collections = parseIdList(options.memoryCollections);
		if (collections.length) body.memory_collections = collections;
		body.waitExecution = wait;

		const useStream = wait && options.stream === true;
		const runOnce = async (requestBody: IDataObject): Promise<IDataObject> => {
			if (useStream) {
				const streamed = await streamAgentExecution.call(this, agentId, requestBody, i, deadline);
				if (!AGENT_SUCCEEDED.includes(String(streamed.status ?? '').toLowerCase())) {
					throw new NodeOperationError(
						this.getNode(),
						`Agent execution ${streamed.id} ended with status "${streamed.status}"`,
						{ itemIndex: i, description: String(streamed.output ?? '') },
					);
				}
				return streamed;
			}
			const response = (await tessApiRequest.call(
				this,
				'POST',
				`/agents/${agentId}/execute`,
				requestBody,
			)) as IDataObject;
			let execution = ((response.responses as IDataObject[] | undefined)?.[0] ??
				response) as IDataObject;
			if (!wait) return execution;

			execution = await waitForAgentResponse.call(this, execution, i, {
				deadline,
				timeoutSeconds,
				intervalSeconds: (options.pollInterval as number) ?? 3,
			});
			if (!AGENT_SUCCEEDED.includes(String(execution.status ?? '').toLowerCase())) {
				throw new NodeOperationError(
					this.getNode(),
					`Agent execution ${execution.id} ended with status "${execution.status}"`,
					{ itemIndex: i, description: String(execution.output ?? '') },
				);
			}
			return execution;
		};

		let execution = await runOnce(body);

		if (outputFormat === 'json') {
			const maxRetries = Math.max(0, Number(this.getNodeParameter('jsonRetries', i, 1)));
			let credits = Number(execution.credits ?? 0);
			for (let attempt = 0; ; attempt++) {
				const extracted = extractJson(execution.output);
				const checked = extracted.ok ? validateSchema(extracted.value, schema) : undefined;
				const problems = extracted.ok ? checked!.errors : [String(extracted.error)];

				if (!problems.length) {
					return {
						...execution,
						credits,
						output_json: checked!.value as IDataObject,
						json_attempts: attempt + 1,
						json_fixes: checked!.fixes,
						agent_id: Number(agentId),
						...extra,
					};
				}
				if (attempt >= maxRetries) {
					throw new NodeOperationError(
						this.getNode(),
						`Agent did not return JSON valid against the schema after ${attempt + 1} attempt(s)`,
						{
							itemIndex: i,
							description: [
								...problems.slice(0, 20).map((p) => `• ${p}`),
								'',
								`Execution ${execution.id} output:`,
								String(execution.output ?? '').slice(0, 2000),
							].join('\n'),
						},
					);
				}
				// pede a correção na mesma conversa (root_id), mantendo os inputs do agente
				execution = await runOnce({
					...body,
					root_id: execution.root_id ?? execution.id,
					messages: [{ role: 'user', content: correctionMessage(problems, schema) }],
				});
				credits += Number(execution.credits ?? 0);
			}
		}

		return { ...execution, agent_id: Number(agentId), ...extra };
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

async function executeAgentResponse(this: IExecuteFunctions, operation: string, i: number) {
	if (operation === 'get') {
		const id = String(this.getNodeParameter('responseId', i)).trim();
		return (await tessApiRequest.call(
			this,
			'GET',
			`/agent-responses/${encodeURIComponent(id)}`,
		)) as IDataObject;
	}
	if (operation === 'getMany') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		return await getMany.call(this, i, '/agent-responses', 'data', { sort: 'desc', ...filters });
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

async function executeFile(this: IExecuteFunctions, operation: string, i: number) {
	if (fileExtraHandlers[operation]) return await fileExtraHandlers[operation].call(this, i);
	if (operation === 'upload') {
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
		const process = this.getNodeParameter('process', i, true) as boolean;
		// v1 (workflows criados até a 0.2.x) não esperava o processamento: o padrão continua false nela
		const waitDefault = this.getNode().typeVersion >= 1.1;
		const waitForProcessing = process
			? (this.getNodeParameter('waitForProcessing', i, waitDefault) as boolean)
			: false;
		const timeoutSeconds = this.getNodeParameter('processingTimeout', i, 600) as number;
		return await uploadBinary.call(this, i, binaryPropertyName, {
			process,
			waitForProcessing,
			deadline: deadlineFrom(timeoutSeconds),
			timeoutSeconds,
		});
	}
	if (operation === 'get' || operation === 'process') {
		const fileId = encodeURIComponent(String(this.getNodeParameter('fileId', i)).trim());
		return operation === 'get'
			? ((await tessApiRequest.call(this, 'GET', `/files/${fileId}`)) as IDataObject)
			: ((await tessApiRequest.call(this, 'POST', `/files/${fileId}/process`, undefined, {
					mode: this.getNodeParameter('processMode', i, 'sync') as string,
				})) as IDataObject);
	}
	if (operation === 'getMany') {
		const order = this.getNodeParameter('order', i, 'desc') as string;
		return await getMany.call(this, i, '/files', 'data', { order }, 100);
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

async function executeMemory(this: IExecuteFunctions, operation: string, i: number) {
	if (memoryExtraHandlers[operation]) return await memoryExtraHandlers[operation].call(this, i);
	const collectionBody = (body: IDataObject) => {
		const collectionId = this.getNodeParameter('collectionId', i, '') as string | number;
		if (collectionId !== '' && collectionId !== null) body.collection_id = Number(collectionId);
		return body;
	};
	const memoryId = () => encodeURIComponent(String(this.getNodeParameter('memoryId', i)).trim());

	if (operation === 'create' || operation === 'update') {
		const body = collectionBody({ memory: this.getNodeParameter('memory', i) as string });
		const response = (await tessApiRequest.call(
			this,
			operation === 'create' ? 'POST' : 'PATCH',
			operation === 'create' ? '/memories' : `/memories/${memoryId()}`,
			body,
		)) as IDataObject;
		return (response.memory as IDataObject | undefined) ?? response;
	}
	if (operation === 'delete') {
		const id = memoryId();
		const response = (await tessApiRequest.call(this, 'DELETE', `/memories/${id}`)) as IDataObject;
		return { deleted: true, id: Number(id) || id, message: response?.message };
	}
	if (operation === 'getMany') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		return await getMany.call(this, i, '/memories', 'memories', filters);
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

async function executeMemoryCollection(this: IExecuteFunctions, operation: string, i: number) {
	if (memoryCollectionExtraHandlers[operation]) {
		return await memoryCollectionExtraHandlers[operation].call(this, i);
	}
	const collectionId = () =>
		encodeURIComponent(String(this.getNodeParameter('collectionId', i)).trim());

	if (operation === 'create' || operation === 'update') {
		const body = { name: this.getNodeParameter('name', i) as string };
		const response = (await tessApiRequest.call(
			this,
			operation === 'create' ? 'POST' : 'PUT',
			operation === 'create' ? '/memory-collections' : `/memory-collections/${collectionId()}`,
			body,
		)) as IDataObject;
		return (response.collection as IDataObject | undefined) ?? response;
	}
	if (operation === 'delete') {
		const id = collectionId();
		const response = (await tessApiRequest.call(
			this,
			'DELETE',
			`/memory-collections/${id}`,
		)) as IDataObject;
		return { deleted: true, id: Number(id) || id, message: response?.message };
	}
	if (operation === 'getMany') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		return await getMany.call(this, i, '/memory-collections', 'collections', {
			search: filters.search,
		});
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import { limiterKey, redisConfigFromCredentials, reserveSlot } from './RateLimiter';

type TessContext = IExecuteFunctions | ILoadOptionsFunctions;

/** Status de execucao de agente que significam "ainda rodando"; qualquer outro encerra a espera. */
const AGENT_IN_PROGRESS = ['starting', 'running', 'queued', 'pending', 'waiting', 'processing', 'in_progress'];
/** Status de execucao de agente que significam sucesso (o stream usa "completed"). */
export const AGENT_SUCCEEDED = ['succeeded', 'completed'];
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_CONNECTION_RETRIES = 2;
const CONNECTION_DROP_CODES = ['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN'];

/** A conexao caiu sem resposta HTTP (proxy/firewall cortou, "socket hang up")? */
function isConnectionDrop(error: unknown, httpCode: string): boolean {
	if (/^\d{3}$/.test(httpCode)) return false;
	if (CONNECTION_DROP_CODES.includes(httpCode)) return true;
	const raw = [dig(error, ['code']), dig(error, ['cause', 'code']), dig(error, ['message'])]
		.filter((v) => v !== undefined)
		.join(' ');
	return CONNECTION_DROP_CODES.some((c) => raw.includes(c)) || /socket hang up/i.test(raw);
}
const SIMPLE_UPLOAD_LIMIT = 32 * 1024 * 1024;
const LARGE_UPLOAD_LIMIT = 200 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Requisicao com fila (rate limit), retry de 429 e mensagens claras
// ---------------------------------------------------------------------------

function dig(source: unknown, path: string[]): unknown {
	let current: unknown = source;
	for (const key of path) {
		if (current === null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

/** Corpo bruto da resposta de erro, como texto (o n8n 2.x entrega em `error.error`, ja como string). */
function rawErrorBody(error: unknown): string | undefined {
	for (const path of [
		['error'],
		['response', 'data'],
		['response', 'body'],
		['cause', 'response', 'data'],
		['cause', 'error'],
		['errorResponse'],
	]) {
		const value = dig(error, path);
		if (value === undefined || value === null || value === '') continue;
		if (typeof value === 'string') return value;
		if (Buffer.isBuffer(value)) return value.toString('utf8');
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}
	return undefined;
}

/** Corpo da resposta como objeto, quando for JSON. */
function errorBody(error: unknown): unknown {
	const raw = rawErrorBody(error);
	if (raw === undefined) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function retryAfterSeconds(error: unknown): number {
	const body = errorBody(error);
	const fromBody = Number(dig(body, ['retry_after']));
	const header =
		dig(error, ['response', 'headers', 'retry-after']) ??
		dig(error, ['cause', 'response', 'headers', 'retry-after']);
	const seconds = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : Number(header);
	return Math.min(60, Number.isFinite(seconds) && seconds > 0 ? seconds : 5);
}

/** Status HTTP da resposta da Tess (undefined = nao houve resposta: falha de rede). */
function httpStatus(error: unknown): number | undefined {
	for (const path of [['statusCode'], ['status'], ['response', 'status'], ['cause', 'response', 'status'], ['httpCode']]) {
		const value = Number(dig(error, path));
		if (Number.isInteger(value) && value >= 100 && value < 600) return value;
	}
	return undefined;
}

export const SOURCE_TESS = 'Tess API';
export const SOURCE_NETWORK = 'Network';
export const SOURCE_NODE = 'Tess AI node';

export interface TessRequestInfo {
	method: string;
	endpoint: string;
}

/** Interpretacao do node para os erros mais comuns (vai como "Node hint", sem esconder a resposta da Tess). */
function nodeHint(status: number, tessMessage: string, tessCode: string, raw: string): string | undefined {
	if (WORKFLOW_TOOL_CODES.includes(tessCode))
		return 'The agent uses a tool/integration (workflow) that Tess could not authenticate. Open the agent in Tess, check its tools/integrations and reconnect them.';
	if (status === 401) return 'Tess rejected the API Key. Check "API Key" in the "Tess AI API" credential.';
	if (status === 403) {
		if (/default collection/i.test(raw)) return 'The default memory collection cannot be deleted.';
		if (/permission|not allowed|feature/i.test(tessMessage))
			return 'The credential works, but the user that owns this API Key has no access to this feature in the workspace (some features, like audit events, need an admin role or a plan that includes them).';
		return 'Check the API Key and the Workspace ID in the "Tess AI API" credential.';
	}
	if (status === 422 && /workspace/i.test(raw))
		return 'Fill in the numeric Workspace ID in the "Tess AI API" credential (Tess → Settings → Workspace).';
	if (status === 404) return 'Check the ID and whether it belongs to this workspace.';
	if (status === 413) return 'File too large for this endpoint.';
	if (status === 429)
		return 'The Tess API allows about 1 request per second per token. Lower "Requests per Second" in the credential or run fewer parallel executions.';
	return undefined;
}

/**
 * Erro de uma chamada a Tess, sempre com a origem explicita:
 * - "Tess API": a Tess respondeu com erro HTTP. A mensagem e exatamente o que a Tess disse e a descricao traz
 *   o corpo bruto da resposta (e o correlation id), para separar erro da Tess de erro do node.
 * - "Network": nao houve resposta (conexao cortada, DNS, proxy, certificado).
 * Tambem registra o erro no log do n8n (n8n.log) com os mesmos dados, em JSON.
 */
function friendlyError(this: TessContext, error: unknown, request: TessRequestInfo): NodeApiError {
	const status = httpStatus(error);
	const raw = rawErrorBody(error) ?? '';
	const body = errorBody(error);
	const where = `${request.method} ${request.endpoint}`;

	if (status === undefined) {
		const code = String(dig(error, ['code']) ?? dig(error, ['cause', 'code']) ?? '').trim();
		const reason = String(dig(error, ['message']) ?? dig(error, ['cause', 'message']) ?? 'no response').trim();
		const message = `No response from Tess (${code || 'network error'}): ${reason}`;
		const description = [
			`Source: ${SOURCE_NETWORK} — the request did not get any answer from Tess (connection dropped, DNS, proxy/firewall or certificate). Tess did not report an error.`,
			`Request: ${where}`,
		].join('\n');
		this.logger?.error('Tess AI request failed', { source: SOURCE_NETWORK, request: where, code, reason });
		const networkError = new NodeApiError(this.getNode(), error as JsonObject, { message, description, httpCode: code || undefined });
		// o n8n troca a mensagem por um texto generico quando reconhece o codigo (ECONNRESET...): mantem a nossa
		networkError.message = message;
		networkError.description = description;
		return networkError;
	}

	const tessMessage = String(
		dig(body, ['message']) ?? dig(body, ['error', 'message']) ?? dig(body, ['errors', '0', 'message']) ?? dig(body, ['error']) ?? '',
	).trim();
	const tessCode = String(dig(body, ['error_code']) ?? dig(body, ['code']) ?? '').trim();
	const correlationId = dig(body, ['correlation_id']) ?? dig(body, ['correlationId']);
	const said = tessMessage && tessMessage !== 'true' ? tessMessage : raw.slice(0, 300) || `HTTP ${status}`;
	const hint = nodeHint(status, tessMessage, tessCode, raw);

	const message = `Tess API error ${status}: ${said}${tessCode ? ` (${tessCode})` : ''}`;
	const description = [
		`Source: ${SOURCE_TESS} (HTTP ${status}) — the message above is exactly what Tess returned.`,
		`Request: ${where}`,
		correlationId ? `Correlation ID: ${String(correlationId)}` : '',
		`Tess response: ${raw ? raw.slice(0, 4000) : '(empty body)'}`,
		hint ? `Node hint: ${hint}` : '',
	]
		.filter(Boolean)
		.join('\n');

	this.logger?.error('Tess AI request failed', {
		source: SOURCE_TESS,
		request: where,
		status,
		tessMessage: said,
		tessCode: tessCode || undefined,
		correlationId: correlationId === undefined ? undefined : String(correlationId),
		tessResponse: raw.slice(0, 4000),
	});
	const apiError = new NodeApiError(this.getNode(), error as JsonObject, { message, description, httpCode: String(status) });
	apiError.message = message;
	apiError.description = description;
	return apiError;
}

/**
 * A chamada deu certo, mas o resultado devolvido pela Tess indica falha (ex.: execucao com status "failed").
 * O objeto da Tess vai inteiro na descricao.
 */
export function tessResultError(
	this: TessContext,
	message: string,
	itemIndex: number,
	payload: unknown,
): NodeOperationError {
	const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
	this.logger?.error('Tess AI reported a failed result', { source: SOURCE_TESS, message, tessResponse: raw.slice(0, 4000) });
	return new NodeOperationError(this.getNode(), message, {
		itemIndex,
		description: [
			`Source: ${SOURCE_TESS} — the request succeeded, but Tess reported this result:`,
			raw.slice(0, 4000),
		].join('\n'),
	});
}

const WORKFLOW_TOOL_CODES = ['WORKFLOW_TOOL_AUTHENTICATION_FAILED'];

const QUEUE_HELP =
	'Every Tess AI call goes through a shared queue in the Redis set in the "Tess AI API" credential, so all workflows and workers respect the Tess limit together. Check the Redis fields in the credential (use the Test button) and that Redis is running and reachable from this n8n process.';

/** Espera a vez desta chamada na fila do token (Redis da credencial). Sem Redis, falha. */
async function waitTurn(this: TessContext, credentials: IDataObject): Promise<void> {
	const { value: redis, problem } = redisConfigFromCredentials(credentials);
	if (!redis) {
		throw new NodeOperationError(
			this.getNode(),
			`Tess AI rate limit queue unavailable: ${problem ?? 'Redis not configured'}`,
			{ description: QUEUE_HELP },
		);
	}
	const slot = await reserveSlot({
		redis,
		identity: limiterKey(String(credentials.apiKey ?? '')),
		requestsPerSecond: Number(credentials.requestsPerSecond ?? 1) || 1,
		log: { info: (message) => this.logger?.info(message) },
	});
	if (!slot.ok) {
		throw new NodeOperationError(
			this.getNode(),
			`Tess AI rate limit queue unavailable: ${slot.problem}`,
			{
				description: [slot.detail ? `Detail: ${slot.detail}.` : '', QUEUE_HELP]
					.filter(Boolean)
					.join(' '),
			},
		);
	}
	const waitMs = slot.waitMs;
	if (waitMs > 0) await sleep(waitMs);
}

export async function tessApiRequest(
	this: TessContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject | FormData,
	qs?: IDataObject,
	/** opcoes HTTP extras (ex.: resposta em texto para SSE); sobrescrevem as padrao */
	extra: Partial<IHttpRequestOptions> = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('tessAiApi');
	const baseUrl = String(credentials.baseUrl || 'https://api.tess.im').replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		headers: { Accept: 'application/json' },
		qs,
		json: true,
	};
	if (body !== undefined) options.body = body;
	Object.assign(options, extra, {
		headers: { ...options.headers, ...(extra.headers ?? {}) },
	});

	for (let attempt = 0; ; attempt++) {
		await waitTurn.call(this, credentials);
		let failure: unknown;
		try {
			return await this.helpers.httpRequestWithAuthentication.call(this, 'tessAiApi', options);
		} catch (error) {
			failure = error;
		}
		const status = httpStatus(failure);
		const code = status === undefined ? String(dig(failure, ['code']) ?? '') : String(status);
		// conexao cortada (proxy/rede) antes de qualquer resposta: repete so leituras, que sao seguras
		if (method === 'GET' && isConnectionDrop(failure, code) && attempt < MAX_CONNECTION_RETRIES) {
			const seconds = 2 ** attempt;
			this.logger?.warn(
				`Tess AI: connection dropped (${code || 'socket'}) on GET ${endpoint}; retrying in ${seconds}s`,
			);
			await sleep(seconds * 1000);
			continue;
		}
		if (code === '429' && attempt < MAX_RATE_LIMIT_RETRIES) {
			const seconds = retryAfterSeconds(failure);
			this.logger?.warn(
				`Tess AI: rate limited (429) on ${method} ${endpoint}; retrying in ${seconds}s`,
			);
			await sleep(seconds * 1000);
			continue;
		}
		throw friendlyError.call(this, failure, { method, endpoint });
	}
}

/**
 * Percorre as paginas de um endpoint de listagem. A Tess usa formatos diferentes:
 * agents / agent-responses → { data, last_page }, files → { data }, memories → { memories, meta.last_page }.
 */
export async function tessApiRequestAllItems(
	this: TessContext,
	endpoint: string,
	dataKey: string,
	qs: IDataObject = {},
	{ limit, perPage = 50 }: { limit?: number; perPage?: number } = {},
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let page = 1;

	while (true) {
		const pageSize = limit ? Math.min(perPage, limit - items.length) : perPage;
		const response = (await tessApiRequest.call(this, 'GET', endpoint, undefined, {
			...qs,
			page,
			per_page: pageSize,
		})) as IDataObject;

		const batch = (response[dataKey] as IDataObject[] | undefined) ?? [];
		items.push(...batch);

		const meta = (response.meta as IDataObject | undefined) ?? response;
		const lastPage = meta.last_page as number | undefined;
		const done =
			batch.length === 0 ||
			(limit !== undefined && items.length >= limit) ||
			(lastPage !== undefined ? page >= lastPage : batch.length < pageSize);
		if (done) break;
		page++;
	}

	return limit !== undefined ? items.slice(0, limit) : items;
}

// ---------------------------------------------------------------------------
// Espera com polling adaptativo
// ---------------------------------------------------------------------------

/** Intervalo crescente: comeca no informado e vai ate 15 s, para gastar menos da cota da API. */
export function nextInterval(current: number, initial: number): number {
	return Math.min(Math.max(15, initial), Math.max(current * 1.5, initial));
}

/**
 * Prazo absoluto (ms) a partir de um timeout em segundos; 0 = sem limite (vale so o timeout de
 * execucao do proprio n8n, se configurado). Um mesmo prazo e compartilhado por todas as etapas
 * de uma operacao (anexos, execucao do agente, correcoes de JSON).
 */
export function deadlineFrom(timeoutSeconds: number): number {
	return timeoutSeconds > 0 ? Date.now() + timeoutSeconds * 1000 : Infinity;
}

interface WaitLimit {
	deadline: number;
	/** so para a mensagem de erro */
	timeoutSeconds: number;
}

/** Aguarda uma execucao de agente chegar a um status final, consultando /agent-responses/{id}. */
export async function waitForAgentResponse(
	this: IExecuteFunctions,
	response: IDataObject,
	itemIndex: number,
	{ deadline, timeoutSeconds, intervalSeconds }: WaitLimit & { intervalSeconds: number },
): Promise<IDataObject> {
	let current = response;
	let interval = intervalSeconds;

	while (AGENT_IN_PROGRESS.includes(String(current.status ?? '').toLowerCase())) {
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`Agent execution ${current.id} did not finish within the ${timeoutSeconds}s timeout (status: ${current.status}). Check it later with "Agent Response → Get" or increase the timeout.`,
				{ itemIndex },
			);
		}
		await sleep(Math.min(interval * 1000, Math.max(0, deadline - Date.now())));
		interval = nextInterval(interval, intervalSeconds);
		current = (await tessApiRequest.call(
			this,
			'GET',
			`/agent-responses/${current.id}`,
		)) as IDataObject;
	}

	const status = String(current.status ?? '').toLowerCase();
	if (!AGENT_SUCCEEDED.includes(status) && !['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
		this.logger?.warn(
			`Tess AI: agent execution ${current.id} returned unknown status "${current.status}"; not waiting any longer`,
		);
	}
	return current;
}

// ---------------------------------------------------------------------------
// Upload de arquivos (ate 32 MB direto; ate 200 MB pelo fluxo v2 com URL assinada)
// ---------------------------------------------------------------------------

const FILE_READY = ['completed', 'processed', 'success', 'succeeded', 'ready', 'done'];
const FILE_FAILED = ['failed', 'error', 'canceled', 'cancelled'];
const FILE_IN_PROGRESS = [
	'waiting',
	'pending',
	'queued',
	'processing',
	'in_progress',
	'in-progress',
	'running',
	'starting',
];

/**
 * Espera o processamento do arquivo. So continua consultando enquanto o status for conhecido como
 * "em andamento"; status desconhecido encerra a espera (com aviso) em vez de prender a execucao.
 */
export async function waitForFileProcessing(
	this: IExecuteFunctions,
	file: IDataObject,
	itemIndex: number,
	{ deadline, timeoutSeconds }: WaitLimit,
): Promise<IDataObject> {
	let current = file;
	// a resposta do upload pode vir sem status: consulta o arquivo antes de decidir
	if (current.status === undefined || current.status === null || current.status === '') {
		current = (await tessApiRequest.call(this, 'GET', `/files/${current.id}`)) as IDataObject;
	}
	let interval = 3;
	while (true) {
		const status = String(current.status ?? '').toLowerCase();
		if (FILE_READY.includes(status)) return current;
		if (FILE_FAILED.includes(status)) {
			throw tessResultError.call(
				this,
				`Tess could not process file ${current.id} (${current.filename ?? ''}): status "${current.status}"`,
				itemIndex,
				current,
			);
		}
		if (!FILE_IN_PROGRESS.includes(status)) {
			this.logger?.warn(
				`Tess AI: file ${current.id} returned unknown status "${current.status}"; not waiting for processing`,
			);
			return current;
		}
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`File ${current.id} was not processed within the ${timeoutSeconds}s timeout (status: ${current.status}). Check it later with "File → Get".`,
				{ itemIndex },
			);
		}
		await sleep(Math.min(interval * 1000, Math.max(0, deadline - Date.now())));
		interval = nextInterval(interval, 3);
		current = (await tessApiRequest.call(this, 'GET', `/files/${current.id}`)) as IDataObject;
	}
}

/** Tamanho do binario sem carrega-lo (metadados do n8n), quando disponivel. */
async function binarySize(this: IExecuteFunctions, meta: IBinaryData): Promise<number | undefined> {
	if (typeof meta.bytes === 'number') return meta.bytes;
	if (meta.id) {
		try {
			const info = await this.helpers.getBinaryMetadata(meta.id);
			if (typeof info.fileSize === 'number') return info.fileSize;
		} catch {
			// sem metadados: confere depois de carregar
		}
		return undefined;
	}
	// binario em memoria (base64)
	return meta.data ? Math.floor((meta.data.length * 3) / 4) : undefined;
}

export async function uploadBinary(
	this: IExecuteFunctions,
	itemIndex: number,
	binaryPropertyName: string,
	{
		process,
		waitForProcessing,
		deadline,
		timeoutSeconds,
	}: { process: boolean; waitForProcessing: boolean } & WaitLimit,
): Promise<IDataObject> {
	const meta = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
	const fileName = meta.fileName || 'file';
	const mimeType = meta.mimeType || 'application/octet-stream';
	const tooLarge = (bytes: number) =>
		new NodeOperationError(
			this.getNode(),
			`File "${fileName}" has ${(bytes / 1024 / 1024).toFixed(1)} MB — the Tess API accepts up to 200 MB`,
			{ itemIndex },
		);

	// confere o tamanho antes de carregar o arquivo na memoria
	const knownSize = await binarySize.call(this, meta);
	if (knownSize !== undefined && knownSize > LARGE_UPLOAD_LIMIT) throw tooLarge(knownSize);

	const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
	const size = buffer.length;
	if (size > LARGE_UPLOAD_LIMIT) throw tooLarge(size);

	let file: IDataObject;
	if (size <= SIMPLE_UPLOAD_LIMIT) {
		const form = new FormData();
		// view sobre o mesmo buffer (sem copia extra)
		const bytes = new Uint8Array(
			buffer.buffer as ArrayBuffer,
			buffer.byteOffset,
			buffer.byteLength,
		);
		form.append('file', new Blob([bytes], { type: mimeType }), fileName);
		form.append('process', process ? 'true' : 'false');
		file = await tessApiRequest.call(this, 'POST', '/files', form);
	} else {
		// fluxo v2: assina → envia direto ao storage → registra
		const signed = await tessApiRequest.call(this, 'POST', '/v2/files/sign', {
			filename: fileName,
			content_type: mimeType,
			size,
		});
		const uploadUrl = String(signed.uploadUrl ?? signed.upload_url ?? '');
		const objectPath = String(signed.objectPath ?? signed.object_path ?? '');
		const requiredHeaders = (signed.requiredHeaders ??
			signed.required_headers ?? {
				'Content-Type': mimeType,
			}) as IDataObject;
		if (!uploadUrl || !objectPath) {
			throw new NodeOperationError(this.getNode(), 'Tess did not return a signed upload URL', {
				itemIndex,
			});
		}
		try {
			await this.helpers.httpRequest({
				method: 'PUT',
				url: uploadUrl,
				headers: requiredHeaders,
				body: buffer,
			});
		} catch (error) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: `Upload of "${fileName}" to the Tess storage failed`,
				itemIndex,
			});
		}
		file = await tessApiRequest.call(this, 'POST', '/v2/files/register', {
			object_path: objectPath,
			filename: fileName,
			content_type: mimeType,
			process,
		});
	}

	if (process && waitForProcessing) {
		file = await waitForFileProcessing.call(this, file, itemIndex, { deadline, timeoutSeconds });
	}
	return file;
}

export function parseIdList(value: unknown): number[] {
	if (Array.isArray(value)) return value.map(Number).filter((n) => !Number.isNaN(n));
	return String(value ?? '')
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean)
		.map(Number)
		.filter((n) => !Number.isNaN(n));
}

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

import { limiterKey, reserveSlot } from './RateLimiter';
import type { CoordinationMode } from './RateLimiter';

type TessContext = IExecuteFunctions | ILoadOptionsFunctions;

const TERMINAL_STATUSES = ['succeeded', 'failed', 'error', 'canceled', 'cancelled'];
const MAX_RATE_LIMIT_RETRIES = 3;
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

/** Corpo da resposta de erro (axios, request ou n8n), quando houver. */
function errorBody(error: unknown): unknown {
	for (const path of [
		['response', 'data'],
		['response', 'body'],
		['cause', 'response', 'data'],
		['error'],
		['errorResponse'],
	]) {
		const value = dig(error, path);
		if (value !== undefined && value !== null && value !== '') return value;
	}
	return undefined;
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

function bodyText(error: unknown): string {
	const body = errorBody(error);
	if (body === undefined) return '';
	return typeof body === 'string' ? body : JSON.stringify(body);
}

/** Traduz os erros mais comuns da Tess para mensagens acionaveis. */
function friendlyError(this: TessContext, error: unknown): NodeApiError {
	const apiError = new NodeApiError(this.getNode(), error as JsonObject);
	const code = String(apiError.httpCode ?? '');
	const text = bodyText(error);
	const detail = text ? `Tess response: ${text.slice(0, 500)}` : undefined;
	const remap = (message: string, description?: string) =>
		new NodeApiError(this.getNode(), error as JsonObject, {
			message,
			description: description ?? detail,
			httpCode: code,
		});

	if (code === '401' || code === '403') {
		if (/default collection/i.test(text))
			return remap('The default memory collection cannot be deleted');
		return remap(
			'Invalid API Key or no access to this workspace',
			'Check the API Key and the Workspace ID in the "Tess AI API" credential.',
		);
	}
	if (code === '422' && /workspace/i.test(text)) {
		return remap(
			'Workspace ID missing or invalid',
			'Fill in the numeric Workspace ID in the "Tess AI API" credential (Tess → Settings → Workspace).',
		);
	}
	if (code === '404')
		return remap('Not found — check the ID and whether it belongs to this workspace');
	if (code === '413') return remap('File too large for this endpoint');
	if (code === '429') {
		return remap(
			'Tess rate limit reached — try again later',
			'The Tess API allows about 1 request per second per token. Lower "Requests per Second" in the credential or run fewer parallel executions.',
		);
	}
	return apiError;
}

/** Espera a vez desta chamada na fila da credencial (memoria do processo ou Redis do n8n). */
async function waitTurn(this: TessContext, credentials: IDataObject): Promise<void> {
	const mode = (credentials.rateLimitMode as CoordinationMode) || 'auto';
	const { waitMs } = await reserveSlot({
		identity: limiterKey(String(credentials.apiKey ?? '')),
		requestsPerSecond: Number(credentials.requestsPerSecond ?? 1) || 1,
		mode,
		redis:
			mode === 'redis'
				? {
						host: String(credentials.redisHost || 'localhost'),
						port: Number(credentials.redisPort || 6379),
						username: credentials.redisUsername ? String(credentials.redisUsername) : undefined,
						password: credentials.redisPassword ? String(credentials.redisPassword) : undefined,
						db: Number(credentials.redisDatabase || 0),
						tls: Boolean(credentials.redisTls),
					}
				: undefined,
		log: {
			info: (message) => this.logger?.info(message),
			warn: (message) => this.logger?.warn(message),
		},
	});
	if (waitMs > 0) await sleep(waitMs);
}

export async function tessApiRequest(
	this: TessContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject | FormData,
	qs?: IDataObject,
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

	for (let attempt = 0; ; attempt++) {
		await waitTurn.call(this, credentials);
		let failure: unknown;
		try {
			return await this.helpers.httpRequestWithAuthentication.call(this, 'tessAiApi', options);
		} catch (error) {
			failure = error;
		}
		const code = String(new NodeApiError(this.getNode(), failure as JsonObject).httpCode ?? '');
		if (code === '429' && attempt < MAX_RATE_LIMIT_RETRIES) {
			const seconds = retryAfterSeconds(failure);
			this.logger?.warn(
				`Tess AI: rate limited (429) on ${method} ${endpoint}; retrying in ${seconds}s`,
			);
			await sleep(seconds * 1000);
			continue;
		}
		throw friendlyError.call(this, failure);
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
function nextInterval(current: number, initial: number): number {
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

	while (!TERMINAL_STATUSES.includes(String(current.status))) {
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
			throw new NodeOperationError(
				this.getNode(),
				`Tess could not process file ${current.id} (${current.filename ?? ''}): status "${current.status}"`,
				{ itemIndex },
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

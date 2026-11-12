// Utilitarios compartilhados pelos handlers dos recursos (actions/*.ts).

import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
} from 'n8n-workflow';
import { jsonParse, NodeOperationError } from 'n8n-workflow';

import { tessApiRequest } from '../GenericFunctions';

export type Handler = (
	this: IExecuteFunctions,
	i: number,
) => Promise<IDataObject | IDataObject[]>;

export type HandlerMap = Record<string, Handler>;

type Ctx = IExecuteFunctions | ILoadOptionsFunctions;

export async function request(
	this: Ctx,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject | FormData,
	qs?: IDataObject,
): Promise<IDataObject> {
	return await tessApiRequest.call(this, method, endpoint, body, qs);
}

// ---------------------------------------------------------------------------
// Parametros
// ---------------------------------------------------------------------------

/** ID numerico (aceita resource locator). Devolve como string pronta para a URL. */
export function numericId(this: IExecuteFunctions, name: string, i: number, label: string): string {
	const raw = this.getNodeParameter(name, i, '', { extractValue: true }) as unknown;
	const value = String(raw ?? '').trim();
	if (!/^[0-9]+$/.test(value)) {
		throw new NodeOperationError(this.getNode(), `Invalid ${label}: "${value}" (expected a number)`, {
			itemIndex: i,
		});
	}
	return value;
}

/** ID textual (aceita resource locator), ja codificado para a URL. */
export function textId(this: IExecuteFunctions, name: string, i: number, label: string): string {
	const raw = this.getNodeParameter(name, i, '', { extractValue: true }) as unknown;
	const value = String(raw ?? '').trim();
	if (!value) {
		throw new NodeOperationError(this.getNode(), `${label} is required`, { itemIndex: i });
	}
	return encodeURIComponent(value);
}

/** Remove vazios ('' / null / undefined); mantem 0 e false. */
export function clean(source: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(source).filter(([, v]) => v !== undefined && v !== null && v !== ''),
	);
}

/** Converte JSON (texto ou objeto) em objeto/lista; vazio = undefined. */
export function parseJson(
	this: IExecuteFunctions,
	value: unknown,
	i: number,
	label: string,
): IDataObject | IDataObject[] | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string') return value as IDataObject;
	if (!value.trim()) return undefined;
	try {
		return jsonParse<IDataObject | IDataObject[]>(value);
	} catch {
		throw new NodeOperationError(this.getNode(), `"${label}" is not valid JSON`, { itemIndex: i });
	}
}

export function parseJsonObject(
	this: IExecuteFunctions,
	value: unknown,
	i: number,
	label: string,
): IDataObject | undefined {
	const parsed = parseJson.call(this, value, i, label);
	if (parsed !== undefined && (Array.isArray(parsed) || typeof parsed !== 'object')) {
		throw new NodeOperationError(this.getNode(), `"${label}" must be a JSON object`, {
			itemIndex: i,
		});
	}
	return parsed as IDataObject | undefined;
}

/** Lista separada por virgulas (ou array) → array de textos. */
export function textList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
	return String(value ?? '')
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);
}

/** Lista separada por virgulas (ou array) → array de numeros. */
export function numberList(value: unknown): number[] {
	return textList(value)
		.map(Number)
		.filter((n) => !Number.isNaN(n));
}

/**
 * Le uma collection de campos opcionais e converte os tipos pedidos:
 * `json` → objeto/lista, `numbers` → array de numeros, `texts` → array de textos.
 */
export function fieldsFrom(
	this: IExecuteFunctions,
	name: string,
	i: number,
	convert: { json?: string[]; numbers?: string[]; texts?: string[] } = {},
): IDataObject {
	const fields = clean(this.getNodeParameter(name, i, {}) as IDataObject);
	for (const key of convert.json ?? []) {
		if (key in fields) fields[key] = parseJson.call(this, fields[key], i, key) as IDataObject;
	}
	for (const key of convert.numbers ?? []) {
		if (key in fields) fields[key] = numberList(fields[key]);
	}
	for (const key of convert.texts ?? []) {
		if (key in fields) fields[key] = textList(fields[key]);
	}
	return clean(fields);
}

/** Campo "Additional Body (JSON)": mescla no corpo (tem prioridade sobre os demais campos). */
export function withExtraBody(
	this: IExecuteFunctions,
	body: IDataObject,
	i: number,
	name = 'extraBody',
): IDataObject {
	const extra = parseJsonObject.call(this, this.getNodeParameter(name, i, ''), i, 'Additional Body (JSON)');
	return extra ? { ...body, ...extra } : body;
}

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

function dig(source: unknown, path: string): unknown {
	let current: unknown = source;
	for (const key of path.split('.')) {
		if (current === null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

const DEFAULT_LIST_KEYS = ['data', 'items', 'data.items', 'data.data', 'results'];

/** Encontra a lista dentro da resposta (a Tess usa chaves diferentes por endpoint). */
export function itemsOf(response: unknown, keys: string[] = []): IDataObject[] {
	if (Array.isArray(response)) return response as IDataObject[];
	for (const key of [...keys, ...DEFAULT_LIST_KEYS]) {
		const value = dig(response, key);
		if (Array.isArray(value)) return value as IDataObject[];
	}
	return [];
}

/** A lista da resposta; se nao achar nenhuma lista, devolve a propria resposta (nao perde dados). */
export function listOrSelf(response: IDataObject, keys: string[] = []): IDataObject | IDataObject[] {
	const items = itemsOf(response, keys);
	if (items.length || Array.isArray(response)) return items;
	return response;
}

/** Objeto principal da resposta: a primeira chave que existir (ex.: data, employee) ou a propria resposta. */
export function unwrap(response: IDataObject, keys: string[] = ['data']): IDataObject {
	for (const key of keys) {
		const value = dig(response, key);
		if (value && typeof value === 'object' && !Array.isArray(value)) return value as IDataObject;
	}
	return response;
}

// ---------------------------------------------------------------------------
// Listagens com Return All / Limit
// ---------------------------------------------------------------------------

export interface ListOptions {
	/**
	 * page   → page/per_page (Laravel: last_page, meta.last_page, has_more)
	 * cursor → per_page|limit + cursor (meta.next_cursor / page.next_cursor)
	 * offset → limit/offset
	 * single → uma chamada so, com "limit" quando houver
	 */
	mode: 'page' | 'cursor' | 'offset' | 'single';
	keys?: string[];
	qs?: IDataObject;
	/** maior tamanho de pagina aceito pelo endpoint */
	maxPageSize?: number;
	/** nome do parametro de tamanho de pagina (padrao: per_page; offset/single: limit) */
	sizeParam?: string;
}

function readLimit(this: IExecuteFunctions, i: number): number | undefined {
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	return returnAll ? undefined : (this.getNodeParameter('limit', i, 50) as number);
}

function hasMore(response: unknown): boolean | undefined {
	for (const key of ['has_more', 'meta.has_more', 'page.has_more', 'pagination.has_more']) {
		const value = dig(response, key);
		if (typeof value === 'boolean') return value;
	}
	return undefined;
}

function nextCursor(response: unknown): string | undefined {
	for (const key of ['meta.next_cursor', 'next_cursor', 'page.next_cursor', 'pagination.next_cursor']) {
		const value = dig(response, key);
		if (typeof value === 'string' && value) return value;
	}
	return undefined;
}

export async function listItems(
	this: IExecuteFunctions,
	i: number,
	endpoint: string,
	{ mode, keys = [], qs = {}, maxPageSize = 50, sizeParam }: ListOptions,
): Promise<IDataObject[]> {
	const limit = readLimit.call(this, i);
	const query = clean(qs);
	const items: IDataObject[] = [];
	const pageSize = () => Math.min(maxPageSize, limit !== undefined ? limit - items.length : maxPageSize);

	if (mode === 'single') {
		const response = await request.call(this, 'GET', endpoint, undefined, {
			...query,
			[sizeParam ?? 'limit']: limit ?? maxPageSize,
		});
		const all = itemsOf(response, keys);
		return limit !== undefined ? all.slice(0, limit) : all;
	}

	let page = 1;
	let cursor: string | undefined;
	let previousFirst: unknown;
	for (let guard = 0; guard < 10000; guard++) {
		const size = pageSize();
		const pageQuery: IDataObject = { ...query };
		if (mode === 'page') Object.assign(pageQuery, { page, [sizeParam ?? 'per_page']: size });
		if (mode === 'offset') Object.assign(pageQuery, { offset: items.length, [sizeParam ?? 'limit']: size });
		if (mode === 'cursor') {
			pageQuery[sizeParam ?? 'per_page'] = size;
			if (cursor) pageQuery.cursor = cursor;
		}

		const response = await request.call(this, 'GET', endpoint, undefined, pageQuery);
		const batch = itemsOf(response, keys);
		// endpoint que ignora a paginacao devolve a mesma pagina de novo: para aqui
		const first = batch[0] ? JSON.stringify(batch[0]) : undefined;
		if (guard > 0 && first !== undefined && first === previousFirst) break;
		previousFirst = first;
		items.push(...batch);

		if (batch.length === 0) break;
		if (limit !== undefined && items.length >= limit) break;
		const more = hasMore(response);
		if (mode === 'cursor') {
			cursor = nextCursor(response);
			if (!cursor || more === false) break;
			continue;
		}
		if (more === false) break;
		const lastPage = Number(dig(response, 'last_page') ?? dig(response, 'meta.last_page'));
		if (mode === 'page' && Number.isFinite(lastPage) && lastPage > 0) {
			if (page >= lastPage) break;
		} else if (more === undefined && batch.length < size) {
			break;
		}
		page++;
	}
	return limit !== undefined ? items.slice(0, limit) : items;
}

// ---------------------------------------------------------------------------
// Server-Sent Events
// ---------------------------------------------------------------------------

export interface SseEvent {
	event?: string;
	data: unknown;
}

/** Interpreta um corpo SSE completo (linhas "event:" / "data:"; ignora comentarios e [DONE]). */
export function parseSse(text: string): SseEvent[] {
	const events: SseEvent[] = [];
	for (const block of String(text ?? '').split(/\r?\n\r?\n/)) {
		let event: string | undefined;
		const data: string[] = [];
		for (const line of block.split(/\r?\n/)) {
			if (line.startsWith('event:')) event = line.slice(6).trim();
			else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
		}
		if (!data.length) continue;
		const raw = data.join('\n');
		if (raw.trim() === '[DONE]') continue;
		let parsed: unknown = raw;
		try {
			parsed = JSON.parse(raw);
		} catch {
			// texto puro: mantem como string
		}
		events.push({ event, data: parsed });
	}
	return events;
}

/** Faz uma chamada cuja resposta e um stream SSE e devolve os eventos quando o stream termina. */
export async function requestSse(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	timeoutMs?: number,
): Promise<SseEvent[]> {
	const response = (await tessApiRequest.call(this, method, endpoint, undefined, undefined, {
		json: false,
		encoding: 'text',
		headers: {
			Accept: 'text/event-stream',
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
		...(timeoutMs && Number.isFinite(timeoutMs) ? { timeout: Math.max(1000, timeoutMs) } : {}),
	})) as unknown;
	return parseSse(typeof response === 'string' ? response : JSON.stringify(response ?? ''));
}

import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type TessContext = IExecuteFunctions | ILoadOptionsFunctions;

const TERMINAL_STATUSES = ['succeeded', 'failed', 'error', 'canceled', 'cancelled'];

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

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'tessAiApi', options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
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

/** Aguarda uma execucao de agente chegar a um status final, consultando /agent-responses/{id}. */
export async function waitForAgentResponse(
	this: IExecuteFunctions,
	response: IDataObject,
	itemIndex: number,
	{ timeoutSeconds, intervalSeconds }: { timeoutSeconds: number; intervalSeconds: number },
): Promise<IDataObject> {
	let current = response;
	const deadline = Date.now() + timeoutSeconds * 1000;

	while (!TERMINAL_STATUSES.includes(String(current.status))) {
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`Agent execution ${current.id} did not finish within ${timeoutSeconds}s (status: ${current.status}). Check it later with "Agent Response → Get" or increase the timeout.`,
				{ itemIndex },
			);
		}
		await sleep(intervalSeconds * 1000);
		current = (await tessApiRequest.call(
			this,
			'GET',
			`/agent-responses/${current.id}`,
		)) as IDataObject;
	}

	return current;
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

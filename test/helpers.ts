// Contexto falso do n8n para executar o node sem um n8n de verdade.
// Registra cada requisicao HTTP e devolve respostas programadas.

import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { vi } from 'vitest';

export interface Call {
	method: string;
	path: string;
	qs?: IDataObject;
	body?: unknown;
	options: IHttpRequestOptions;
}

export const CREDENTIALS = {
	apiKey: 'test-key',
	workspaceId: '42',
	baseUrl: 'https://api.tess.im',
	requestsPerSecond: 1,
	redisHost: '127.0.0.1',
	redisPort: 6379,
};

type Responder = (call: Call) => unknown;

export function fakeContext(
	params: Record<string, unknown>,
	responder: Responder = () => ({}),
	{ typeVersion = 1.1, binary }: { typeVersion?: number; binary?: Buffer } = {},
) {
	const calls: Call[] = [];
	const httpRequestWithAuthentication = vi.fn(async (_cred: string, options: IHttpRequestOptions) => {
		const url = new URL(String(options.url));
		const call: Call = {
			method: String(options.method ?? 'GET'),
			path: url.pathname,
			qs: options.qs as IDataObject | undefined,
			body: options.body,
			options,
		};
		calls.push(call);
		return responder(call);
	});

	const getNodeParameter = (
		name: string,
		_i: number,
		fallback?: unknown,
		options?: { extractValue?: boolean },
	) => {
		if (name in params) {
			const value = params[name];
			// resource locator: o n8n devolve so o valor quando extractValue = true
			if (options?.extractValue && value && typeof value === 'object' && 'value' in value) {
				return (value as { value: unknown }).value;
			}
			return value;
		}
		// "inputs.value" e afins
		const [head, ...rest] = name.split('.');
		if (rest.length && head in params) {
			let value: unknown = params[head];
			for (const key of rest) value = (value as IDataObject | undefined)?.[key];
			return value ?? fallback;
		}
		if (fallback !== undefined) return fallback;
		throw new Error(`Test did not provide parameter "${name}"`);
	};

	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter,
		getCredentials: async () => CREDENTIALS,
		getNode: () => ({ name: 'Tess AI', type: 'tessAi', typeVersion, parameters: {} }),
		continueOnFail: () => false,
		logger: { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined },
		helpers: {
			httpRequestWithAuthentication,
			httpRequest: vi.fn(async () => ({})),
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (items: unknown[]) => items,
			assertBinaryData: () => ({ fileName: 'a.png', mimeType: 'image/png', bytes: binary?.length ?? 3 }),
			getBinaryDataBuffer: async () => binary ?? Buffer.from('abc'),
			getBinaryMetadata: async () => ({ fileSize: binary?.length ?? 3 }),
		},
	};
	return { ctx: ctx as unknown as IExecuteFunctions, calls };
}

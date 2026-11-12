// Comportamentos que vao alem de "qual endpoint": paginacao, streams, espera de runs e Redis.

import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../nodes/TessAi/RateLimiter', async (original) => ({
	...(await original<typeof import('../nodes/TessAi/RateLimiter')>()),
	reserveSlot: async () => ({ ok: true, waitMs: 0 }),
}));

import { parseSse } from '../nodes/TessAi/actions/common';
import { redisConfigFromCredentials } from '../nodes/TessAi/RateLimiter';
import { TessAi } from '../nodes/TessAi/TessAi.node';
import { fakeContext } from './helpers';

const node = new TessAi();
const run = async (params: Record<string, unknown>, responder: Parameters<typeof fakeContext>[1]) => {
	const { ctx, calls } = fakeContext(params, responder);
	const [items] = await node.execute.call(ctx);
	return { items: items.map((i) => i.json as IDataObject), calls };
};

describe('paginacao', () => {
	it('page: segue ate last_page e respeita Return All', async () => {
		const { items, calls } = await run(
			{ resource: 'webhook', operation: 'getMany', scope: 'all', returnAll: true },
			(call) => {
				const page = Number(call.qs?.page);
				return { data: [{ id: page }], last_page: 3 };
			},
		);
		expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
		expect(calls).toHaveLength(3);
	});

	it('page: para quando a API ignora a pagina e repete os itens', async () => {
		const { items, calls } = await run(
			{ resource: 'digitalEmployee', operation: 'getMany', returnAll: true, filters: {} },
			() => ({ data: Array.from({ length: 50 }, (_, n) => ({ id: n })) }),
		);
		expect(items).toHaveLength(50);
		expect(calls).toHaveLength(2);
	});

	it('cursor: usa meta.next_cursor ate has_more = false', async () => {
		const { items, calls } = await run(
			{ resource: 'artifact', operation: 'getMany', returnAll: true },
			(call) =>
				call.qs?.cursor
					? { data: [{ universal_id: 'b' }], meta: { has_more: false } }
					: { data: [{ universal_id: 'a' }], meta: { has_more: true, next_cursor: 'c1' } },
		);
		expect(items.map((i) => i.universal_id)).toEqual(['a', 'b']);
		expect(calls[1].qs).toMatchObject({ cursor: 'c1' });
	});

	it('offset: avanca o offset pelo numero de itens recebidos e para na pagina curta', async () => {
		const total = 250;
		const { items, calls } = await run(
			{ resource: 'digitalEmployeeRun', operation: 'getMany', employee: '7', returnAll: true, filters: {} },
			(call) => {
				const offset = Number(call.qs?.offset);
				const size = Math.min(Number(call.qs?.limit), Math.max(0, total - offset));
				return { data: { runs: Array.from({ length: size }, (_, n) => ({ id: offset + n })) } };
			},
		);
		expect(items).toHaveLength(total);
		expect(calls.map((c) => c.qs?.offset)).toEqual([0, 100, 200]);
	});
});

describe('SSE', () => {
	it('interpreta eventos com nome, JSON, texto e [DONE]', () => {
		const events = parseSse(
			': heartbeat\n\nevent: delta\ndata: {"delta":"Ol"}\n\ndata: plain\n\ndata: [DONE]\n\n',
		);
		expect(events).toEqual([
			{ event: 'delta', data: { delta: 'Ol' } },
			{ event: undefined, data: 'plain' },
		]);
	});

	it('Agent → Execute com Stream Response junta a saida em uma chamada so', async () => {
		const stream = [
			'data: {"id": 1, "status": "running", "output": "Ola, ", "error": null, "root_id": 1}',
			'data: {"id": 1, "status": "running", "output": "mundo", "error": null, "root_id": 1}',
			'data: {"id": 1, "status": "completed", "output": "", "error": null, "credits": 10, "root_id": 1}',
		].join('\n\n');
		const { items, calls } = await run(
			{
				resource: 'agent',
				operation: 'execute',
				agent: '10',
				message: 'oi',
				inputs: { value: {} },
				waitForCompletion: true,
				outputFormat: 'text',
				options: { stream: true },
			},
			() => stream,
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].options.body).toContain('"stream":true');
		expect(calls[0].options.body).not.toContain('waitExecution');
		expect(items[0]).toMatchObject({ id: 1, status: 'completed', output: 'Ola, mundo', credits: 10 });
	});
});

describe('Agent → Execute com polling', () => {
	it('para em status desconhecido em vez de esperar ate o timeout', async () => {
		const { calls } = await run(
			{
				resource: 'agent',
				operation: 'execute',
				agent: '10',
				message: 'oi',
				inputs: { value: {} },
				waitForCompletion: true,
				outputFormat: 'text',
				options: { pollInterval: 1, timeout: 30 },
			},
			(call) =>
				call.path.endsWith('/execute')
					? { responses: [{ id: 5, status: 'completed', output: 'ok' }] }
					: { id: 5, status: 'completed', output: 'ok' },
		);
		expect(calls).toHaveLength(1);
	});
});

describe('Digital Employee → Invoke', () => {
	it('acompanha o run ate terminar e devolve o output', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
		let polls = 0;
		const { items, calls } = await run(
			{ resource: 'digitalEmployee', operation: 'invoke', employee: '7', waitForCompletion: true, invokeOptions: { pollInterval: 1, timeout: 60 } },
			(call) => {
				if (call.path.endsWith('/invoke')) return { data: { run: { id: 501, status: 'running' } } };
				if (call.path.endsWith('/output')) return { data: { output: 'feito' } };
				polls++;
				return { data: { run: { id: 501, status: polls < 2 ? 'running' : 'completed' } } };
			},
		);
		vi.useRealTimers();
		expect(calls.map((c) => c.path)).toEqual([
			'/digital-employees/7/invoke',
			'/digital-employees/7/runs/501',
			'/digital-employees/7/runs/501',
			'/digital-employees/7/runs/501/output',
		]);
		expect(items[0]).toMatchObject({ id: 501, status: 'completed', output: { output: 'feito' } });
	});
});

describe('erros da Tess e da rede', () => {
	const audit = { resource: 'account', operation: 'getAuditEvents', from: '2026-11-01', to: '2026-11-02', filters: {}, returnAll: false, limit: 50 };

	// formato real do n8n 2.x (legacy request): status em statusCode e o corpo da Tess como TEXTO em `error`
	const tessHttpError = (status: number, body: string) =>
		Object.assign(new Error(`${status} - ${JSON.stringify(body)}`), {
			statusCode: status,
			status,
			error: body,
			response: { status, statusText: 'x', headers: {} },
		});
	const failure = async (params: Record<string, unknown>, error: unknown) => {
		try {
			await run(params, () => {
				throw error;
			});
		} catch (e) {
			return e as { message: string; description: string; httpCode?: string };
		}
		throw new Error('era para falhar');
	};

	it('erro HTTP: mensagem exata da Tess, origem "Tess API", requisicao e corpo bruto', async () => {
		const body = '{"message":"You do not have permission to access this feature.","type":"error","status":403}';
		const err = await failure(audit, tessHttpError(403, body));
		expect(err.message).toBe('Tess API error 403: You do not have permission to access this feature.');
		expect(err.description).toContain('Source: Tess API (HTTP 403)');
		expect(err.description).toContain('Request: GET /audit-events');
		expect(err.description).toContain(`Tess response: ${body}`);
		expect(err.description).toMatch(/Node hint: The credential works/);
	});

	it('erro HTTP com corpo nao-JSON mostra o texto da Tess como veio', async () => {
		const err = await failure(audit, tessHttpError(502, '<html>Bad Gateway</html>'));
		expect(err.message).toBe('Tess API error 502: <html>Bad Gateway</html>');
		expect(err.description).toContain('Tess response: <html>Bad Gateway</html>');
	});

	it('correlation id e error_code da Tess aparecem', async () => {
		const body = '{"message":"Tool auth failed","error_code":"WORKFLOW_TOOL_AUTHENTICATION_FAILED","correlation_id":"abc-123"}';
		const err = await failure(audit, tessHttpError(500, body));
		expect(err.message).toBe('Tess API error 500: Tool auth failed (WORKFLOW_TOOL_AUTHENTICATION_FAILED)');
		expect(err.description).toContain('Correlation ID: abc-123');
	});

	it('sem resposta: origem "Network", deixando claro que a Tess nao reportou erro', async () => {
		const err = await failure(
			{ resource: 'agent', operation: 'execute', agent: '10', message: 'oi', inputs: { value: {} }, waitForCompletion: false, outputFormat: 'text', options: {} },
			Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
		);
		expect(err.message).toBe('No response from Tess (ECONNRESET): socket hang up');
		expect(err.description).toContain('Source: Network');
		expect(err.description).toContain('Request: POST /agents/10/execute');
	});

	it('erro do proprio node: origem "Tess AI node"', async () => {
		const err = await failure({ resource: 'nope', operation: 'x' }, new Error('nao chamado'));
		expect(err.message).toContain('Unknown resource');
		expect(err.description).toContain('Source: Tess AI node');
	});

	it('execucao que a Tess reporta como falha traz o objeto da Tess', async () => {
		const { ctx } = fakeContext(
			{ resource: 'agent', operation: 'execute', agent: '10', message: 'oi', inputs: { value: {} }, waitForCompletion: true, outputFormat: 'text', options: { pollInterval: 1, timeout: 30 } },
			() => ({ responses: [{ id: 9, status: 'failed', error: 'model overloaded', output: '' }] }),
		);
		const e = await node.execute.call(ctx).catch((x) => x as { message: string; description: string });
		expect(e.message).toBe('Agent execution 9 ended with status "failed": model overloaded');
		expect(e.description).toContain('Source: Tess API — the request succeeded, but Tess reported this result:');
		expect(e.description).toContain('"error":"model overloaded"');
	});

	it('GET com conexao cortada (socket hang up) tenta de novo', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
		let calls = 0;
		const { items } = await run(audit, () => {
			if (++calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
			return { data: [{ id: 'e1' }], meta: { has_more: false } };
		});
		vi.useRealTimers();
		expect(calls).toBe(2);
		expect(items.map((i) => i.id)).toEqual(['e1']);
	});

	it('POST com conexao cortada nao repete (poderia duplicar a acao)', async () => {
		let calls = 0;
		await expect(
			run({ resource: 'agent', operation: 'execute', agent: '10', message: 'oi', inputs: { value: {} }, waitForCompletion: false, outputFormat: 'text', options: {} }, () => {
				calls++;
				throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
			}),
		).rejects.toThrow();
		expect(calls).toBe(1);
	});
});

describe('Redis da credencial', () => {
	it('exige host e valida a porta', () => {
		expect(redisConfigFromCredentials({}).problem).toMatch(/Redis Host/);
		expect(redisConfigFromCredentials({ redisHost: 'h', redisPort: 70000 }).problem).toMatch(/Port/);
	});

	it('monta a configuracao com opcionais vazios removidos', () => {
		expect(
			redisConfigFromCredentials({
				redisHost: ' redis.local ',
				redisPort: 6380,
				redisUsername: '',
				redisPassword: 's3cret',
				redisDatabase: 2,
				redisTls: true,
			}).value,
		).toEqual({ host: 'redis.local', port: 6380, username: undefined, password: 's3cret', db: 2, tls: true });
	});
});

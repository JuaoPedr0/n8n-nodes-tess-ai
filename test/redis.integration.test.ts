// Integracao com um Redis de verdade (o Memurai local de teste em 127.0.0.1:6379).
// Pulado automaticamente quando nao ha Redis respondendo — por isso o CI continua sem Redis.

import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';

import { limiterKey, reserveSlot, testRedis } from '../nodes/TessAi/RateLimiter';

const HOST = process.env.TESS_TEST_REDIS_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TESS_TEST_REDIS_PORT ?? 6379);

const redisUp = await new Promise<boolean>((resolve) => {
	const socket = connect({ host: HOST, port: PORT });
	socket.setTimeout(500);
	socket.once('connect', () => {
		socket.destroy();
		resolve(true);
	});
	socket.once('timeout', () => {
		socket.destroy();
		resolve(false);
	});
	socket.once('error', () => resolve(false));
});

describe.skipIf(!redisUp)(`Redis real em ${HOST}:${PORT}`, () => {
	const redis = { host: HOST, port: PORT };

	it('o teste da credencial passa (PING + script Lua)', async () => {
		expect(await testRedis(redis)).toEqual({ ok: true });
	});

	it('a fila espaca as chamadas do mesmo token (2 req/s → ~500 ms)', async () => {
		const identity = limiterKey(`teste-${Date.now()}`);
		const waits: number[] = [];
		for (let n = 0; n < 3; n++) {
			const slot = await reserveSlot({ redis, identity, requestsPerSecond: 2 });
			expect(slot.ok).toBe(true);
			if (slot.ok) waits.push(slot.waitMs);
		}
		expect(waits[0]).toBe(0);
		expect(waits[1]).toBeGreaterThan(300);
		expect(waits[2]).toBeGreaterThan(800);
	});

	it('senha errada gera mensagem clara', async () => {
		const result = await testRedis({ ...redis, password: 'senha-errada-de-teste' });
		// sem senha configurada o Redis responde que AUTH nao e necessario: tambem e um erro de credencial
		expect(result.ok).toBe(false);
	});
});

describe('Redis inexistente', () => {
	it('o teste da credencial explica que nao conectou', async () => {
		const result = await testRedis({ host: '127.0.0.1', port: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/Could not connect to Redis 127\.0\.0\.1:1/);
	});
});

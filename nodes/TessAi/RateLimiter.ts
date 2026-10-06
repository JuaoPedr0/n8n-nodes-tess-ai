// Fila global de chamadas a API da Tess (limite padrao: 1 requisicao/segundo por token).
//
// O n8n nao coordena limites de API entre workflows. Este modulo e carregado uma vez por processo,
// entao o estado abaixo e compartilhado por todos os workflows/execucoes daquele processo. Em queue mode
// (main + workers) cada worker e um processo: a coordenacao entre eles usa o Redis do proprio n8n
// (variaveis QUEUE_BULL_REDIS_*), com um cliente RESP minimo (sem dependencias de runtime).
//
// Algoritmo: cada chamada "reserva um horario" — o proximo slot livre do token — e espera ate ele.
// No Redis a reserva e atomica (script Lua) e usa o relogio do Redis, entao todos os workers formam uma
// fila unica e ordenada.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export interface RedisConfig {
	host: string;
	port: number;
	username?: string;
	password?: string;
	db?: number;
	tls?: boolean;
}

export type CoordinationMode = 'auto' | 'memory' | 'redis';

export interface LimiterLog {
	info?: (message: string) => void;
	warn?: (message: string) => void;
}

export interface ReserveOptions {
	/** chave da fila (ver limiterKey) */
	identity: string;
	requestsPerSecond: number;
	mode: CoordinationMode;
	/** usado quando mode = 'redis' */
	redis?: RedisConfig;
	log?: LimiterLog;
}

const COMMAND_TIMEOUT_MS = 2000;
const REDIS_RETRY_AFTER_MS = 30_000;

// ---------------------------------------------------------------------------
// Fila em memoria (por processo)
// ---------------------------------------------------------------------------

const nextFreeInMemory = new Map<string, number>();

function reserveInMemory(key: string, intervalMs: number): number {
	const now = Date.now();
	const slot = Math.max(now, nextFreeInMemory.get(key) ?? 0);
	nextFreeInMemory.set(key, slot + intervalMs);
	return slot - now;
}

// ---------------------------------------------------------------------------
// Cliente RESP minimo
// ---------------------------------------------------------------------------

type RespValue = string | number | null | RespValue[];

interface Pending {
	resolve: (value: RespValue) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof globalThis.setTimeout>;
}

function encode(args: string[]): Buffer {
	let out = `*${args.length}\r\n`;
	for (const arg of args) out += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
	return Buffer.from(out);
}

/** Le um valor RESP a partir de `offset`. Retorna undefined se o buffer ainda nao tem o valor inteiro. */
function parse(
	buf: Buffer,
	offset: number,
): { value: RespValue | Error; next: number } | undefined {
	const lineEnd = buf.indexOf('\r\n', offset);
	if (lineEnd === -1) return undefined;
	const type = String.fromCharCode(buf[offset]);
	const line = buf.toString('utf8', offset + 1, lineEnd);
	const after = lineEnd + 2;

	if (type === '+') return { value: line, next: after };
	if (type === '-') return { value: new Error(line), next: after };
	if (type === ':') return { value: Number(line), next: after };
	if (type === '$') {
		const len = Number(line);
		if (len === -1) return { value: null, next: after };
		if (buf.length < after + len + 2) return undefined;
		return { value: buf.toString('utf8', after, after + len), next: after + len + 2 };
	}
	if (type === '*') {
		const count = Number(line);
		if (count === -1) return { value: null, next: after };
		const items: RespValue[] = [];
		let pos = after;
		for (let n = 0; n < count; n++) {
			const item = parse(buf, pos);
			if (!item) return undefined;
			items.push(item.value instanceof Error ? item.value.message : item.value);
			pos = item.next;
		}
		return { value: items, next: pos };
	}
	return { value: new Error(`unexpected RESP type "${type}"`), next: buf.length };
}

class RedisClient {
	private socket?: Socket;
	private buffer = Buffer.alloc(0);
	private pending: Pending[] = [];
	private ready?: Promise<void>;

	constructor(private readonly config: RedisConfig) {}

	async command(args: string[]): Promise<RespValue> {
		await this.connect();
		return await this.send(args);
	}

	private connect(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = new Promise<void>((resolve, reject) => {
			const { host, port, tls } = this.config;
			const socket = tls
				? tlsConnect({ host, port, servername: host })
				: netConnect({ host, port });
			this.socket = socket;
			socket.setNoDelay(true);
			socket.setTimeout(COMMAND_TIMEOUT_MS);

			// eventos de um socket antigo nao podem derrubar a conexao nova
			const isCurrent = () => this.socket === socket;
			const fail = (error: Error) => {
				if (isCurrent()) this.reset(error);
				reject(error);
			};
			socket.once(tls ? 'secureConnect' : 'connect', async () => {
				if (!isCurrent()) return;
				socket.setTimeout(0); // daqui em diante cada comando tem o proprio timeout
				try {
					const { username, password, db } = this.config;
					if (password) {
						await this.send(username ? ['AUTH', username, password] : ['AUTH', password]);
					}
					if (db) await this.send(['SELECT', String(db)]);
					resolve();
				} catch (error) {
					fail(error as Error);
				}
			});
			socket.on('data', (chunk: Buffer) => {
				if (isCurrent()) this.onData(chunk);
			});
			socket.on('timeout', () => fail(new Error(`Redis connection timeout (${host}:${port})`)));
			socket.on('error', (error) => fail(error));
			socket.on('close', () => {
				if (isCurrent()) this.reset(new Error('Redis connection closed'));
			});
		});
		return this.ready;
	}

	private send(args: string[]): Promise<RespValue> {
		return new Promise<RespValue>((resolve, reject) => {
			const socket = this.socket;
			if (!socket || socket.destroyed) {
				reject(new Error('Redis not connected'));
				return;
			}
			// sem resposta a tempo: a conexao fica fora de sincronia → descarta e reconecta depois
			const timer = globalThis.setTimeout(() => {
				if (this.socket === socket) {
					this.reset(new Error(`Redis command timeout (${args[0]}, ${COMMAND_TIMEOUT_MS} ms)`));
				}
			}, COMMAND_TIMEOUT_MS);
			this.pending.push({ resolve, reject, timer });
			socket.write(encode(args));
		});
	}

	private onData(chunk: Buffer) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		let offset = 0;
		while (offset < this.buffer.length) {
			const parsed = parse(this.buffer, offset);
			if (!parsed) break;
			offset = parsed.next;
			const waiter = this.pending.shift();
			if (!waiter) continue;
			globalThis.clearTimeout(waiter.timer);
			if (parsed.value instanceof Error) waiter.reject(parsed.value);
			else waiter.resolve(parsed.value);
		}
		this.buffer = this.buffer.subarray(offset);
	}

	private reset(error: Error) {
		for (const waiter of this.pending.splice(0)) {
			globalThis.clearTimeout(waiter.timer);
			waiter.reject(error);
		}
		this.buffer = Buffer.alloc(0);
		this.ready = undefined;
		const socket = this.socket;
		this.socket = undefined;
		if (socket && !socket.destroyed) socket.destroy();
	}
}

// ---------------------------------------------------------------------------
// Reserva no Redis
// ---------------------------------------------------------------------------

// KEYS[1] = chave do token, ARGV[1] = intervalo em ms. Devolve quantos ms esperar.
const RESERVE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local interval = tonumber(ARGV[1])
local nextFree = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = now
if nextFree > now then slot = nextFree end
redis.call('SET', KEYS[1], tostring(slot + interval), 'PX', (slot + interval - now) + 60000)
return slot - now
`;

/** Estado por servidor Redis: um Redis com problema nao afeta credenciais que usam outro. */
interface RedisState {
	client: RedisClient;
	retryAt: number;
	down: boolean;
	announced: boolean;
}

const redisStates = new Map<string, RedisState>();

function redisId(config: RedisConfig): string {
	return `${config.tls ? 'tls' : 'tcp'}://${config.username ?? ''}@${config.host}:${config.port}/${config.db ?? 0}`;
}

function stateFor(config: RedisConfig): RedisState {
	const id = redisId(config);
	let state = redisStates.get(id);
	if (!state) {
		state = { client: new RedisClient(config), retryAt: 0, down: false, announced: false };
		redisStates.set(id, state);
	}
	return state;
}

// ---------------------------------------------------------------------------
// Configuracao do Redis do n8n (queue mode) — lida uma vez por processo
// ---------------------------------------------------------------------------

function env(name: string): string | undefined {
	const value = process.env[name];
	if (value !== undefined && value !== '') return value;
	const file = process.env[`${name}_FILE`];
	if (file) {
		try {
			return readFileSync(file, 'utf8').trim();
		} catch {
			return undefined;
		}
	}
	return undefined;
}

let queueRedisCache: { value: RedisConfig | undefined } | undefined;

/** Redis que o n8n usa em queue mode, ou undefined se o processo nao estiver em queue mode. */
export function n8nQueueRedis(): RedisConfig | undefined {
	if (queueRedisCache) return queueRedisCache.value;
	let value: RedisConfig | undefined;
	const queueMode = env('EXECUTIONS_MODE') === 'queue';
	const host = env('QUEUE_BULL_REDIS_HOST');
	// Redis Cluster nao e suportado → fila em memoria
	if ((queueMode || host) && !env('QUEUE_BULL_REDIS_CLUSTER_NODES')) {
		value = {
			host: host ?? 'localhost',
			port: Number(env('QUEUE_BULL_REDIS_PORT') ?? 6379),
			username: env('QUEUE_BULL_REDIS_USERNAME'),
			password: env('QUEUE_BULL_REDIS_PASSWORD'),
			db: Number(env('QUEUE_BULL_REDIS_DB') ?? 0),
			tls: env('QUEUE_BULL_REDIS_TLS') === 'true',
		};
	}
	queueRedisCache = { value };
	return value;
}

/** So para testes: esquece a configuracao lida do ambiente. */
export function resetQueueRedisCache() {
	queueRedisCache = undefined;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** A Tess limita por token: a fila e por API Key (o workspace nao entra na chave). */
export function limiterKey(apiKey: string): string {
	return `n8n-tess:rl:${createHash('sha256').update(apiKey).digest('hex').slice(0, 24)}`;
}

/**
 * Reserva a vez desta chamada e devolve quantos ms esperar antes de envia-la.
 * Nunca lanca: se o Redis falhar, usa a fila em memoria (e avisa no log a cada queda e retorno).
 */
export async function reserveSlot(
	options: ReserveOptions,
): Promise<{ waitMs: number; via: 'redis' | 'memory' }> {
	const rps = options.requestsPerSecond > 0 ? options.requestsPerSecond : 1;
	const intervalMs = Math.max(1, Math.round(1000 / rps));
	const key = options.identity;

	const redis =
		options.mode === 'memory'
			? undefined
			: options.mode === 'redis'
				? options.redis
				: n8nQueueRedis();

	if (redis) {
		const state = stateFor(redis);
		if (Date.now() >= state.retryAt) {
			try {
				const result = await state.client.command([
					'EVAL',
					RESERVE_SCRIPT,
					'1',
					key,
					String(intervalMs),
				]);
				if (state.down) {
					state.down = false;
					options.log?.warn?.(
						`Tess AI rate limit: Redis ${redis.host}:${redis.port} is back; coordination restored`,
					);
				} else if (!state.announced) {
					options.log?.info?.(
						`Tess AI rate limit: coordinated via Redis ${redis.host}:${redis.port} (${rps} req/s)`,
					);
				}
				state.announced = true;
				return { waitMs: Math.max(0, Number(result) || 0), via: 'redis' };
			} catch (error) {
				// evita pagar timeout de conexao a cada chamada enquanto este Redis estiver fora
				state.retryAt = Date.now() + REDIS_RETRY_AFTER_MS;
				if (!state.down) {
					state.down = true;
					options.log?.warn?.(
						`Tess AI rate limit: Redis ${redis.host}:${redis.port} unavailable (${(error as Error).message}); using the in-process queue and retrying Redis every ${REDIS_RETRY_AFTER_MS / 1000}s`,
					);
				}
			}
		}
	}
	return { waitMs: reserveInMemory(key, intervalMs), via: 'memory' };
}

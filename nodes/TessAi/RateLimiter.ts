// Fila global de chamadas a API da Tess (limite padrao: 1 requisicao/segundo por token).
//
// O n8n nao coordena limites de API entre workflows. Este modulo e carregado uma vez por processo,
// entao o estado abaixo e compartilhado por todos os workflows/execucoes daquele processo. Em queue mode
// (main + workers) cada worker e um processo: a coordenacao entre eles usa o Redis do proprio n8n
// (variaveis QUEUE_BULL_REDIS_*), com um cliente RESP minimo (sem dependencias de runtime).
//
// Algoritmo: cada chamada "reserva um horario" — o proximo slot livre da credencial — e espera ate ele.
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

export interface ReserveOptions {
	/** identifica a credencial (workspace + token) */
	identity: string;
	requestsPerSecond: number;
	mode: CoordinationMode;
	/** usado quando mode = 'redis' */
	redis?: RedisConfig;
	warn?: (message: string) => void;
}

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

	constructor(
		private readonly config: RedisConfig,
		private readonly timeoutMs = 2000,
	) {}

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
			socket.setTimeout(this.timeoutMs);

			const fail = (error: Error) => {
				this.reset(error);
				reject(error);
			};
			socket.once(tls ? 'secureConnect' : 'connect', async () => {
				socket.setTimeout(0);
				try {
					const { username, password, db } = this.config;
					if (password)
						await this.send(username ? ['AUTH', username, password] : ['AUTH', password]);
					if (db) await this.send(['SELECT', String(db)]);
					resolve();
				} catch (error) {
					fail(error as Error);
				}
			});
			socket.on('data', (chunk: Buffer) => this.onData(chunk));
			socket.on('timeout', () => fail(new Error(`Redis connection timeout (${host}:${port})`)));
			socket.on('error', (error) => fail(error));
			socket.on('close', () => this.reset(new Error('Redis connection closed')));
		});
		return this.ready;
	}

	private send(args: string[]): Promise<RespValue> {
		return new Promise<RespValue>((resolve, reject) => {
			if (!this.socket || this.socket.destroyed) {
				reject(new Error('Redis not connected'));
				return;
			}
			this.pending.push({ resolve, reject });
			this.socket.write(encode(args));
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
			if (parsed.value instanceof Error) waiter.reject(parsed.value);
			else waiter.resolve(parsed.value);
		}
		this.buffer = this.buffer.subarray(offset);
	}

	private reset(error: Error) {
		for (const waiter of this.pending.splice(0)) waiter.reject(error);
		this.buffer = Buffer.alloc(0);
		this.ready = undefined;
		if (this.socket && !this.socket.destroyed) this.socket.destroy();
		this.socket = undefined;
	}
}

// ---------------------------------------------------------------------------
// Reserva no Redis
// ---------------------------------------------------------------------------

// KEYS[1] = chave da credencial, ARGV[1] = intervalo em ms. Devolve quantos ms esperar.
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

const clients = new Map<string, RedisClient>();

function clientFor(config: RedisConfig): RedisClient {
	const id = `${config.tls ? 'tls' : 'tcp'}://${config.username ?? ''}@${config.host}:${config.port}/${config.db ?? 0}`;
	let client = clients.get(id);
	if (!client) {
		client = new RedisClient(config);
		clients.set(id, client);
	}
	return client;
}

// ---------------------------------------------------------------------------
// Configuracao do Redis do n8n (queue mode)
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

/** Redis que o n8n usa em queue mode, ou undefined se o processo nao estiver em queue mode. */
export function n8nQueueRedis(): RedisConfig | undefined {
	const queueMode = env('EXECUTIONS_MODE') === 'queue';
	const host = env('QUEUE_BULL_REDIS_HOST');
	if (!queueMode && !host) return undefined;
	if (env('QUEUE_BULL_REDIS_CLUSTER_NODES')) return undefined; // cluster nao suportado → memoria
	return {
		host: host ?? 'localhost',
		port: Number(env('QUEUE_BULL_REDIS_PORT') ?? 6379),
		username: env('QUEUE_BULL_REDIS_USERNAME'),
		password: env('QUEUE_BULL_REDIS_PASSWORD'),
		db: Number(env('QUEUE_BULL_REDIS_DB') ?? 0),
		tls: env('QUEUE_BULL_REDIS_TLS') === 'true',
	};
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const REDIS_RETRY_AFTER_MS = 30_000;
let warnedFallback = false;
let announced = false;
let redisRetryAt = 0;

export function limiterKey(workspaceId: string, apiKey: string): string {
	return `n8n-tess:rl:${createHash('sha256').update(`${workspaceId}:${apiKey}`).digest('hex').slice(0, 24)}`;
}

/**
 * Reserva a vez desta chamada e devolve quantos ms esperar antes de envia-la.
 * Nunca lanca: se o Redis falhar, usa a fila em memoria (e avisa uma vez no log).
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

	if (redis && Date.now() >= redisRetryAt) {
		try {
			const result = await clientFor(redis).command([
				'EVAL',
				RESERVE_SCRIPT,
				'1',
				key,
				String(intervalMs),
			]);
			if (!announced) {
				announced = true;
				options.warn?.(
					`Tess AI rate limit: coordinated via Redis ${redis.host}:${redis.port} (${rps} req/s)`,
				);
			}
			return { waitMs: Math.max(0, Number(result) || 0), via: 'redis' };
		} catch (error) {
			// evita pagar o timeout de conexao a cada chamada enquanto o Redis estiver fora
			redisRetryAt = Date.now() + REDIS_RETRY_AFTER_MS;
			if (!warnedFallback) {
				warnedFallback = true;
				options.warn?.(
					`Tess AI rate limit: Redis unavailable (${(error as Error).message}); falling back to in-process queue`,
				);
			}
		}
	}
	return { waitMs: reserveInMemory(key, intervalMs), via: 'memory' };
}

// Fila global de chamadas a API da Tess (limite padrao: 1 requisicao/segundo por token).
//
// O n8n nao coordena limites de API entre workflows nem entre workers. A fila fica sempre no Redis da
// infraestrutura do n8n — o mesmo das variaveis QUEUE_BULL_REDIS_* —, entao todas as execucoes de todos
// os workers (e o n8n local de desenvolvimento, apontado para o mesmo Redis) formam uma fila unica.
// Cliente RESP minimo, sem dependencias de runtime.
//
// Algoritmo: cada chamada "reserva um horario" — o proximo slot livre do token — e espera ate ele.
// A reserva e atomica (script Lua) e usa o relogio do Redis.
//
// Sem Redis (nao configurado, fora do ar ou sem resposta) a chamada FALHA: o node nunca chama a Tess
// sem passar pela fila.

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

export interface LimiterLog {
	info?: (message: string) => void;
	warn?: (message: string) => void;
}

export interface ReserveOptions {
	/** chave da fila (ver limiterKey) */
	identity: string;
	requestsPerSecond: number;
	log?: LimiterLog;
}

export type ReserveResult =
	| { ok: true; waitMs: number }
	| { ok: false; problem: string; detail?: string };

const COMMAND_TIMEOUT_MS = 2000;

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
			socket.on('timeout', () => fail(new Error(`connection timeout (${host}:${port})`)));
			socket.on('error', (error) => fail(error));
			socket.on('close', () => {
				if (isCurrent()) this.reset(new Error('connection closed'));
			});
		});
		return this.ready;
	}

	private send(args: string[]): Promise<RespValue> {
		return new Promise<RespValue>((resolve, reject) => {
			const socket = this.socket;
			if (!socket || socket.destroyed) {
				reject(new Error('not connected'));
				return;
			}
			// sem resposta a tempo: a conexao fica fora de sincronia → descarta e reconecta depois
			const timer = globalThis.setTimeout(() => {
				if (this.socket === socket) {
					this.reset(new Error(`no reply to ${args[0]} within ${COMMAND_TIMEOUT_MS} ms`));
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

const clients = new Map<string, RedisClient>();
let announced = false;

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
// Configuracao: variaveis do n8n (QUEUE_BULL_REDIS_*) — lidas uma vez por processo
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

let configCache: { value?: RedisConfig; problem?: string } | undefined;

/** Redis do n8n a partir das variaveis QUEUE_BULL_REDIS_*; `problem` explica por que nao ha config. */
export function n8nRedisConfig(): { value?: RedisConfig; problem?: string } {
	if (configCache) return configCache;
	const host =
		env('QUEUE_BULL_REDIS_HOST') ?? (env('EXECUTIONS_MODE') === 'queue' ? 'localhost' : undefined);
	if (!host) {
		configCache = {
			problem:
				'Redis not configured: set QUEUE_BULL_REDIS_HOST (and _PORT, _PASSWORD, _DB, _TLS if needed) in the n8n environment',
		};
	} else if (env('QUEUE_BULL_REDIS_CLUSTER_NODES')) {
		configCache = { problem: 'Redis Cluster (QUEUE_BULL_REDIS_CLUSTER_NODES) is not supported' };
	} else {
		configCache = {
			value: {
				host,
				port: Number(env('QUEUE_BULL_REDIS_PORT') ?? 6379),
				username: env('QUEUE_BULL_REDIS_USERNAME'),
				password: env('QUEUE_BULL_REDIS_PASSWORD'),
				db: Number(env('QUEUE_BULL_REDIS_DB') ?? 0),
				tls: env('QUEUE_BULL_REDIS_TLS') === 'true',
			},
		};
	}
	return configCache;
}

/** So para testes: esquece a configuracao lida do ambiente. */
export function resetRedisConfigCache() {
	configCache = undefined;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** A Tess limita por token: a fila e por API Key (o workspace nao entra na chave). */
export function limiterKey(apiKey: string): string {
	return `n8n-tess:rl:${createHash('sha256').update(apiKey).digest('hex').slice(0, 24)}`;
}

/**
 * Reserva a vez desta chamada na fila do Redis e devolve quantos ms esperar antes de envia-la.
 * Sem Redis (nao configurado, fora do ar ou sem resposta) devolve ok: false com o motivo.
 */
export async function reserveSlot(options: ReserveOptions): Promise<ReserveResult> {
	const rps = options.requestsPerSecond > 0 ? options.requestsPerSecond : 1;
	const intervalMs = Math.max(1, Math.round(1000 / rps));

	const { value: redis, problem } = n8nRedisConfig();
	if (!redis) return { ok: false, problem: problem ?? 'Redis not configured' };

	let result: RespValue;
	try {
		result = await clientFor(redis).command([
			'EVAL',
			RESERVE_SCRIPT,
			'1',
			options.identity,
			String(intervalMs),
		]);
	} catch (error) {
		// o detalhe tecnico (ex.: ECONNREFUSED) vai separado: o n8n troca mensagens com esses codigos por texto generico
		return {
			ok: false,
			problem: `Redis ${redis.host}:${redis.port} unavailable`,
			detail: (error as Error).message,
		};
	}
	if (!announced) {
		announced = true;
		options.log?.info?.(
			`Tess AI rate limit: queue on Redis ${redis.host}:${redis.port} (${rps} req/s per token)`,
		);
	}
	return { ok: true, waitMs: Math.max(0, Number(result) || 0) };
}

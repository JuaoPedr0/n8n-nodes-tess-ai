// Fila global de chamadas a API da Tess (limite padrao: 1 requisicao/segundo por token).
//
// O n8n nao coordena limites de API entre workflows nem entre workers. A fila fica num Redis informado
// na credencial "Tess AI API" (em producao, normalmente o mesmo Redis do n8n em queue mode), entao todas
// as execucoes de todos os workers que usam a mesma API Key formam uma fila unica.
// Cliente RESP minimo, sem dependencias de runtime.
//
// Algoritmo: cada chamada "reserva um horario" — o proximo slot livre do token — e espera ate ele.
// A reserva e atomica (script Lua) e usa o relogio do Redis.
//
// Sem Redis (nao configurado, fora do ar ou sem resposta) a chamada FALHA: o node nunca chama a Tess
// sem passar pela fila.

import { createHash } from 'node:crypto';
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
	/** Redis da fila (ver redisConfigFromCredentials) */
	redis: RedisConfig;
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

	close() {
		this.reset(new Error('connection closed by client'));
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
const announced = new Set<string>();

function clientId(config: RedisConfig): string {
	// a senha entra (como hash) para que trocar a senha na credencial abra uma conexao nova
	const secret = createHash('sha256')
		.update(config.password ?? '')
		.digest('hex')
		.slice(0, 12);
	return `${config.tls ? 'tls' : 'tcp'}://${config.username ?? ''}:${secret}@${config.host}:${config.port}/${config.db ?? 0}`;
}

function clientFor(config: RedisConfig): RedisClient {
	const id = clientId(config);
	let client = clients.get(id);
	if (!client) {
		client = new RedisClient(config);
		clients.set(id, client);
	}
	return client;
}

// ---------------------------------------------------------------------------
// Configuracao: campos Redis da credencial "Tess AI API"
// ---------------------------------------------------------------------------

/** Campos da credencial usados aqui (nomes iguais aos de TessAiApi.credentials.ts). */
export interface RedisCredentialFields {
	redisHost?: unknown;
	redisPort?: unknown;
	redisUsername?: unknown;
	redisPassword?: unknown;
	redisDatabase?: unknown;
	redisTls?: unknown;
}

/** Redis da fila a partir da credencial; `problem` explica o que falta preencher. */
export function redisConfigFromCredentials(credentials: RedisCredentialFields): {
	value?: RedisConfig;
	problem?: string;
} {
	const host = String(credentials.redisHost ?? '').trim();
	if (!host) {
		return { problem: 'Redis Host is empty in the "Tess AI API" credential' };
	}
	const port = Number(credentials.redisPort ?? 6379);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return { problem: `Redis Port "${String(credentials.redisPort)}" is not a valid port` };
	}
	const db = Number(credentials.redisDatabase ?? 0);
	const username = String(credentials.redisUsername ?? '').trim();
	const password = String(credentials.redisPassword ?? '');
	return {
		value: {
			host,
			port,
			username: username || undefined,
			password: password || undefined,
			db: Number.isInteger(db) && db > 0 ? db : 0,
			tls: credentials.redisTls === true,
		},
	};
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

	const { redis } = options;

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
	const id = `${clientId(redis)}|${options.identity}`;
	if (!announced.has(id)) {
		announced.add(id);
		options.log?.info?.(
			`Tess AI rate limit: queue on Redis ${redis.host}:${redis.port} (${rps} req/s per token)`,
		);
	}
	return { ok: true, waitMs: Math.max(0, Number(result) || 0) };
}

/**
 * Teste da credencial: conecta (AUTH/SELECT), faz PING e roda o script da fila numa chave de teste,
 * o que confirma que o servidor aceita Lua (EVAL) e TIME. Usa uma conexao propria, fechada no fim.
 */
export async function testRedis(config: RedisConfig): Promise<{ ok: true } | { ok: false; message: string }> {
	const client = new RedisClient(config);
	const where = `${config.host}:${config.port}`;
	try {
		try {
			await client.command(['PING']);
		} catch (error) {
			const text = (error as Error).message;
			if (/NOAUTH|WRONGPASS|invalid password|invalid username/i.test(text)) {
				return {
					ok: false,
					message: `Redis ${where} rejected the credentials (${text}). Check Redis User and Redis Password.`,
				};
			}
			return {
				ok: false,
				message: `Could not connect to Redis ${where}: ${text}. Check Redis Host, Port and TLS, and that Redis is running and reachable from n8n.`,
			};
		}
		try {
			await client.command(['EVAL', RESERVE_SCRIPT, '1', 'n8n-tess:rl:credential-test', '1']);
		} catch (error) {
			return {
				ok: false,
				message: `Redis ${where} does not accept the rate limit script (EVAL with TIME): ${(error as Error).message}. Use Redis 5 or newer (or a compatible server with Lua scripting).`,
			};
		}
		return { ok: true };
	} finally {
		client.close();
	}
}

// Teste da credencial "Tess AI API" (botao Test). Valida, nesta ordem:
//   1. Redis da fila: conexao, AUTH/SELECT, PING e o script Lua da fila (EVAL + TIME)
//   2. Tess: API Key e Workspace ID com uma chamada leve (GET /agents?per_page=1), passando pela fila
// Cada falha devolve uma mensagem que diz qual campo corrigir.

import type {
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
} from 'n8n-workflow';
import { sleep } from 'n8n-workflow';

import { limiterKey, redisConfigFromCredentials, reserveSlot, testRedis } from './RateLimiter';

export const DEFAULT_BASE_URL = 'https://api.tess.im';

function statusOf(error: unknown): number | undefined {
	const e = error as { statusCode?: number; response?: { status?: number; statusCode?: number } };
	return e?.statusCode ?? e?.response?.status ?? e?.response?.statusCode;
}

function tessMessageOf(error: unknown): string {
	const body = (error as { error?: unknown })?.error;
	if (body && typeof body === 'object') {
		const b = body as Record<string, unknown>;
		return String(b.message ?? b.error ?? '').trim();
	}
	return typeof body === 'string' ? body.slice(0, 200) : '';
}

export async function tessAiApiTest(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted<ICredentialDataDecryptedObject>,
): Promise<INodeCredentialTestResult> {
	const data = credential.data ?? {};

	// 1. Redis
	const { value: redis, problem } = redisConfigFromCredentials(data);
	if (!redis) return { status: 'Error', message: problem ?? 'Redis not configured' };
	const redisCheck = await testRedis(redis);
	if (!redisCheck.ok) return { status: 'Error', message: redisCheck.message };

	const apiKey = String(data.apiKey ?? '').trim();
	const workspaceId = String(data.workspaceId ?? '').trim();
	if (!apiKey) return { status: 'Error', message: 'API Key is empty' };
	if (!/^[0-9]+$/.test(workspaceId)) {
		return {
			status: 'Error',
			message: `Workspace ID must be numeric (got "${workspaceId}"). Find it in Tess → Settings → Workspace.`,
		};
	}

	// 2. Tess (respeitando a fila do token, como qualquer chamada do node)
	const slot = await reserveSlot({
		redis,
		identity: limiterKey(apiKey),
		requestsPerSecond: Number(data.requestsPerSecond ?? 1) || 1,
	});
	if (!slot.ok) {
		return { status: 'Error', message: `${slot.problem}${slot.detail ? `: ${slot.detail}` : ''}` };
	}
	if (slot.waitMs > 0) await sleep(slot.waitMs);

	const baseUrl = String(data.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
	try {
		// ICredentialTestFunctions so oferece helpers.request (nao ha httpRequest no contexto de teste)
		// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
		await this.helpers.request({
			method: 'GET',
			uri: `${baseUrl}/agents`,
			qs: { per_page: 1 },
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'x-workspace-id': workspaceId,
			},
			json: true,
		});
	} catch (error) {
		const status = statusOf(error);
		const tess = tessMessageOf(error);
		const suffix = tess ? ` Tess said: "${tess}".` : '';
		if (status === 401 || status === 403) {
			return {
				status: 'Error',
				message: `Tess rejected the API Key or it has no access to workspace ${workspaceId} (HTTP ${status}).${suffix}`,
			};
		}
		if (status === 422) {
			return {
				status: 'Error',
				message: `Tess rejected the Workspace ID ${workspaceId} (HTTP 422).${suffix}`,
			};
		}
		if (status === 429) {
			return {
				status: 'Error',
				message: `Tess rate limit reached (HTTP 429) — wait a minute and test again.${suffix}`,
			};
		}
		if (status) {
			return { status: 'Error', message: `Tess API error ${status}.${suffix || ` ${(error as Error).message}`}` };
		}
		return {
			status: 'Error',
			message: `No response from Tess at ${baseUrl} (network: connection, DNS, proxy or certificate — Tess did not report an error): ${(error as Error).message}`,
		};
	}

	return {
		status: 'OK',
		message: `Connection OK: Redis ${redis.host}:${redis.port} and Tess workspace ${workspaceId}`,
	};
}

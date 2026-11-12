// Cada operacao do node chama o endpoint certo da Tess (metodo, caminho, query e corpo).
// A fila de rate limit (Redis) e substituida por uma que libera na hora.

import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../nodes/TessAi/RateLimiter', async (original) => ({
	...(await original<typeof import('../nodes/TessAi/RateLimiter')>()),
	reserveSlot: async () => ({ ok: true, waitMs: 0 }),
}));

import { TessAi } from '../nodes/TessAi/TessAi.node';
import { fakeContext } from './helpers';

const AGENT = { agent: { mode: 'id', value: '10' } };
const EMPLOYEE = { employee: { mode: 'id', value: '7' } };
const ARTIFACT = { artifact: { mode: 'id', value: 'art_1' } };
const PAGE = { returnAll: false, limit: 5 };

interface Case {
	resource: string;
	operation: string;
	params?: Record<string, unknown>;
	method: string;
	path: string;
	qs?: IDataObject;
	body?: unknown;
	response?: unknown;
}

const cases: Case[] = [
	// Agent
	{ resource: 'agent', operation: 'getMany', params: { ...PAGE, filters: {} }, method: 'GET', path: '/agents' },
	{ resource: 'agent', operation: 'get', params: AGENT, method: 'GET', path: '/agents/10' },
	{ resource: 'agent', operation: 'linkFiles', params: { ...AGENT, fileIds: '1, 2' }, method: 'POST', path: '/agents/10/files', body: { file_ids: [1, 2] } },
	{ resource: 'agent', operation: 'listFiles', params: AGENT, method: 'GET', path: '/agents/10/files' },
	{ resource: 'agent', operation: 'unlinkFile', params: { ...AGENT, fileId: '5' }, method: 'DELETE', path: '/agents/10/files/5' },
	{
		resource: 'agent',
		operation: 'chatCompletion',
		params: { ...AGENT, chatMessages: { messages: [{ role: 'user', content: 'oi' }] }, chatOptions: { model: 'tess-6' }, simplify: false, extraBody: '' },
		method: 'POST',
		path: '/agents/10/openai/chat/completions',
		body: { messages: [{ role: 'user', content: 'oi' }], model: 'tess-6', stream: false },
	},
	{
		resource: 'agent',
		operation: 'execute',
		params: { ...AGENT, message: 'oi', inputs: { value: {} }, waitForCompletion: false, options: {} },
		method: 'POST',
		path: '/agents/10/execute',
		body: { messages: [{ role: 'user', content: 'oi' }], waitExecution: false },
		response: { responses: [{ id: 1, status: 'starting' }] },
	},
	// Agent Response
	{ resource: 'agentResponse', operation: 'get', params: { responseId: '99' }, method: 'GET', path: '/agent-responses/99' },
	{ resource: 'agentResponse', operation: 'getMany', params: { ...PAGE, filters: {} }, method: 'GET', path: '/agent-responses' },
	// Agent Version
	{ resource: 'agentVersion', operation: 'getMany', params: { ...AGENT, ...PAGE }, method: 'GET', path: '/agents/10/versions' },
	{ resource: 'agentVersion', operation: 'get', params: { ...AGENT, versionNumber: 3 }, method: 'GET', path: '/agents/10/versions/3' },
	{ resource: 'agentVersion', operation: 'rollback', params: { ...AGENT, versionNumber: 3 }, method: 'POST', path: '/agents/10/versions/3/rollback' },
	// Agent Scheduler
	{ resource: 'agentScheduler', operation: 'getMany', params: { scope: 'all', ...PAGE }, method: 'GET', path: '/schedulers' },
	{ resource: 'agentScheduler', operation: 'getMany', params: { scope: 'agent', ...AGENT, ...PAGE }, method: 'GET', path: '/agents/10/schedulers' },
	{ resource: 'agentScheduler', operation: 'get', params: { ...AGENT, schedulerId: '4' }, method: 'GET', path: '/agents/10/schedulers/4' },
	{
		resource: 'agentScheduler',
		operation: 'create',
		params: { ...AGENT, name: 'Diario', prompt: 'Resumo', rootExecutionId: 555, additionalFields: { cron_expression: '0 9 * * *', enabled: true } },
		method: 'POST',
		path: '/agents/10/schedulers',
		body: { name: 'Diario', prompt: 'Resumo', agent_root_id_execution: 555, cron_expression: '0 9 * * *', enabled: true },
	},
	{ resource: 'agentScheduler', operation: 'update', params: { ...AGENT, schedulerId: '4', updateFields: { enabled: false } }, method: 'PUT', path: '/agents/10/schedulers/4', body: { enabled: false } },
	{ resource: 'agentScheduler', operation: 'delete', params: { ...AGENT, schedulerId: '4' }, method: 'DELETE', path: '/agents/10/schedulers/4' },
	{ resource: 'agentScheduler', operation: 'deleteByRootExecution', params: { ...AGENT, rootExecutionId: 555 }, method: 'DELETE', path: '/agents/10/schedulers/by-root-execution/555' },
	// Webhook
	{ resource: 'webhook', operation: 'getMany', params: { scope: 'all', ...PAGE }, method: 'GET', path: '/webhooks' },
	{ resource: 'webhook', operation: 'getMany', params: { scope: 'agent', ...AGENT, ...PAGE }, method: 'GET', path: '/agents/10/webhooks' },
	{ resource: 'webhook', operation: 'create', params: { ...AGENT, url: 'https://x.y/h', method: 'POST', status: 'active' }, method: 'POST', path: '/agents/10/webhooks', body: { url: 'https://x.y/h', method: 'POST', status: 'active' } },
	{ resource: 'webhook', operation: 'delete', params: { webhookId: '18' }, method: 'DELETE', path: '/webhooks/18' },
	// File
	{ resource: 'file', operation: 'get', params: { fileId: '3' }, method: 'GET', path: '/files/3' },
	{ resource: 'file', operation: 'getMany', params: { ...PAGE, order: 'desc' }, method: 'GET', path: '/files' },
	{ resource: 'file', operation: 'process', params: { fileId: '3', processMode: 'async' }, method: 'POST', path: '/files/3/process', qs: { mode: 'async' } },
	{ resource: 'file', operation: 'delete', params: { fileId: '3' }, method: 'DELETE', path: '/files/3' },
	{ resource: 'file', operation: 'updateVisibility', params: { fileId: '3', visibility: 'public' }, method: 'PATCH', path: '/files/3/visibility', body: { visibility: 'public' } },
	{ resource: 'file', operation: 'resolveReference', params: { reference: 'doc://file_1', resolveOptions: {} }, method: 'POST', path: '/files/resolve', body: { ref: 'doc://file_1' } },
	{
		resource: 'file',
		operation: 'upload',
		params: { binaryPropertyName: 'data', process: false, processingTimeout: 60 },
		method: 'POST',
		path: '/files',
	},
	// Memory
	{ resource: 'memory', operation: 'create', params: { memory: 'fato', collectionId: '2' }, method: 'POST', path: '/memories', body: { memory: 'fato', collection_id: 2 } },
	{ resource: 'memory', operation: 'update', params: { memoryId: '8', memory: 'novo', collectionId: '' }, method: 'PATCH', path: '/memories/8', body: { memory: 'novo' } },
	{ resource: 'memory', operation: 'delete', params: { memoryId: '8' }, method: 'DELETE', path: '/memories/8' },
	{ resource: 'memory', operation: 'getMany', params: { ...PAGE, filters: {} }, method: 'GET', path: '/memories' },
	{ resource: 'memory', operation: 'importFromText', params: { importText: 'Joao gosta de cafe', importOptions: { collection_id: '2', wait: true }, extraBody: '' }, method: 'POST', path: '/memory-import', qs: { wait: true }, body: { text: 'Joao gosta de cafe', collection_id: 2 } },
	{ resource: 'memory', operation: 'getImportStatus', params: { importId: 'abc' }, method: 'GET', path: '/memory-import/abc' },
	// Memory Collection
	{ resource: 'memoryCollection', operation: 'create', params: { name: 'Contratos' }, method: 'POST', path: '/memory-collections', body: { name: 'Contratos' } },
	{ resource: 'memoryCollection', operation: 'update', params: { collectionId: '2', name: 'X' }, method: 'PUT', path: '/memory-collections/2', body: { name: 'X' } },
	{ resource: 'memoryCollection', operation: 'delete', params: { collectionId: '2' }, method: 'DELETE', path: '/memory-collections/2' },
	{ resource: 'memoryCollection', operation: 'getMany', params: { ...PAGE, filters: {} }, method: 'GET', path: '/memory-collections' },
	{ resource: 'memoryCollection', operation: 'getIds', params: { filters: { search: 'con' } }, method: 'GET', path: '/memory-collections/ids', qs: { search: 'con' } },
	// Artifact
	{ resource: 'artifact', operation: 'getMany', params: PAGE, method: 'GET', path: '/artifacts' },
	{ resource: 'artifact', operation: 'getTemplates', method: 'GET', path: '/artifact-templates' },
	{ resource: 'artifact', operation: 'create', params: { title: 'T', content: '<p>x</p>', additionalFields: { lang: 'pt-BR' } }, method: 'POST', path: '/artifacts', body: { title: 'T', content: '<p>x</p>', lang: 'pt-BR' } },
	{ resource: 'artifact', operation: 'get', params: ARTIFACT, method: 'GET', path: '/artifacts/art_1' },
	{ resource: 'artifact', operation: 'rename', params: { ...ARTIFACT, title: 'Novo' }, method: 'PATCH', path: '/artifacts/art_1', body: { title: 'Novo' } },
	{ resource: 'artifact', operation: 'delete', params: ARTIFACT, method: 'DELETE', path: '/artifacts/art_1' },
	{ resource: 'artifact', operation: 'edit', params: { ...ARTIFACT, operations: '[{"op":"append","text":"x"}]', baseVersion: 2 }, method: 'POST', path: '/artifacts/art_1/edit', body: { operations: [{ op: 'append', text: 'x' }], base_version: 2 } },
	{ resource: 'artifact', operation: 'publish', params: { ...ARTIFACT, version: 0 }, method: 'POST', path: '/artifacts/art_1/publish', body: {} },
	{ resource: 'artifact', operation: 'unpublish', params: ARTIFACT, method: 'DELETE', path: '/artifacts/art_1/publish' },
	{ resource: 'artifact', operation: 'restoreVersion', params: { ...ARTIFACT, version: 2 }, method: 'POST', path: '/artifacts/art_1/restore', body: { version: 2 } },
	{
		resource: 'artifact',
		operation: 'share',
		params: { ...ARTIFACT, access: { changes: [{ action: 'grant', type: 'workspace' }, { action: 'revoke', type: 'user', email: 'a@b.c' }] } },
		method: 'POST',
		path: '/artifacts/art_1/share',
		body: { grant: [{ type: 'workspace' }], revoke: [{ type: 'user', email: 'a@b.c' }] },
	},
	{ resource: 'artifact', operation: 'getVersions', params: ARTIFACT, method: 'GET', path: '/artifacts/art_1/versions' },
	{ resource: 'artifact', operation: 'deleteVersion', params: { ...ARTIFACT, version: 2 }, method: 'DELETE', path: '/artifacts/art_1/versions/2' },
	// Digital Employee
	{ resource: 'digitalEmployee', operation: 'getCapabilities', method: 'GET', path: '/digital-employees/capabilities' },
	{ resource: 'digitalEmployee', operation: 'getMany', params: { ...PAGE, filters: { agent_id: 10 } }, method: 'GET', path: '/digital-employees' },
	{
		resource: 'digitalEmployee',
		operation: 'createStandalone',
		params: { name: 'Fin', employeeFields: { connectors_json: 'slack, gmail', goal_json: '{"title":"x"}', knowledge_base_file_ids: '1,2' }, extraBody: '' },
		method: 'POST',
		path: '/digital-employees/standalone',
		body: { name: 'Fin', connectors_json: ['slack', 'gmail'], goal_json: { title: 'x' }, knowledge_base_file_ids: [1, 2] },
	},
	{ resource: 'digitalEmployee', operation: 'createFromAgent', params: { ...AGENT, name: 'Fin', employeeFields: {}, extraBody: '' }, method: 'POST', path: '/digital-employees/agents/10', body: { name: 'Fin' } },
	{ resource: 'digitalEmployee', operation: 'get', params: EMPLOYEE, method: 'GET', path: '/digital-employees/7' },
	{ resource: 'digitalEmployee', operation: 'update', params: { ...EMPLOYEE, employeeFields: { status: 'active' }, extraBody: '{"name":"N"}' }, method: 'PUT', path: '/digital-employees/7', body: { status: 'active', name: 'N' } },
	{ resource: 'digitalEmployee', operation: 'duplicate', params: EMPLOYEE, method: 'POST', path: '/digital-employees/7/duplicate' },
	{ resource: 'digitalEmployee', operation: 'delete', params: EMPLOYEE, method: 'DELETE', path: '/digital-employees/7' },
	{ resource: 'digitalEmployee', operation: 'previewSchedule', params: { heartbeatCron: '0 9 * * *', scheduleOptions: { execution_timezone: 'America/Sao_Paulo' } }, method: 'POST', path: '/digital-employees/schedule-preview', body: { heartbeat_cron: '0 9 * * *', execution_timezone: 'America/Sao_Paulo' } },
	{ resource: 'digitalEmployee', operation: 'invoke', params: { ...EMPLOYEE, waitForCompletion: false }, method: 'POST', path: '/digital-employees/7/invoke', body: {} },
	{ resource: 'digitalEmployee', operation: 'pause', params: { ...EMPLOYEE, reason: 'ferias' }, method: 'POST', path: '/digital-employees/7/pause', body: { reason: 'ferias' } },
	{ resource: 'digitalEmployee', operation: 'resume', params: EMPLOYEE, method: 'POST', path: '/digital-employees/7/resume' },
	{ resource: 'digitalEmployee', operation: 'getRollbackOptions', params: { ...EMPLOYEE, ...PAGE }, method: 'GET', path: '/digital-employees/7/rollback-options', qs: { limit: 5 } },
	{ resource: 'digitalEmployee', operation: 'rollback', params: { ...EMPLOYEE, version: 2 }, method: 'POST', path: '/digital-employees/7/rollback', body: { version: 2 } },
	{ resource: 'digitalEmployee', operation: 'reparent', params: { ...EMPLOYEE, parentEmployeeId: 3 }, method: 'POST', path: '/digital-employees/7/reparent', body: { parent_employee_id: 3 } },
	{ resource: 'digitalEmployee', operation: 'detach', params: EMPLOYEE, method: 'POST', path: '/digital-employees/7/detach' },
	{ resource: 'digitalEmployee', operation: 'getActivity', params: { ...EMPLOYEE, ...PAGE }, method: 'GET', path: '/digital-employees/7/activity', qs: { limit: 5 } },
	{ resource: 'digitalEmployee', operation: 'getFiles', params: EMPLOYEE, method: 'GET', path: '/digital-employees/7/files' },
	{ resource: 'digitalEmployee', operation: 'updateGoal', params: { ...EMPLOYEE, goalTitle: 'Meta', goalFields: { status: 'active' } }, method: 'PUT', path: '/digital-employees/7/goal', body: { title: 'Meta', status: 'active' } },
	{ resource: 'digitalEmployee', operation: 'approve', params: EMPLOYEE, method: 'POST', path: '/digital-employees/7/approve' },
	{ resource: 'digitalEmployee', operation: 'reject', params: EMPLOYEE, method: 'POST', path: '/digital-employees/7/reject' },
	{ resource: 'digitalEmployee', operation: 'uploadAvatar', params: { binaryPropertyName: 'data', avatarName: '' }, method: 'POST', path: '/digital-employees/avatar-upload' },
	// Digital Employee Run
	{ resource: 'digitalEmployeeRun', operation: 'getMany', params: { ...EMPLOYEE, ...PAGE, filters: {} }, method: 'GET', path: '/digital-employees/7/runs', qs: { offset: 0, limit: 5 } },
	{ resource: 'digitalEmployeeRun', operation: 'get', params: { ...EMPLOYEE, runId: '501' }, method: 'GET', path: '/digital-employees/7/runs/501' },
	{ resource: 'digitalEmployeeRun', operation: 'getOutput', params: { ...EMPLOYEE, runId: '501' }, method: 'GET', path: '/digital-employees/7/runs/501/output' },
	{ resource: 'digitalEmployeeRun', operation: 'getSummary', params: EMPLOYEE, method: 'GET', path: '/digital-employees/7/runs/summary' },
	{ resource: 'digitalEmployeeRun', operation: 'retry', params: { ...EMPLOYEE, runId: '501' }, method: 'POST', path: '/digital-employees/7/runs/501/retry' },
	{ resource: 'digitalEmployeeRun', operation: 'stream', params: { ...EMPLOYEE, runId: '501', timeout: 10 }, method: 'GET', path: '/digital-employees/7/runs/501/stream', response: 'event: complete\ndata: {"status":"completed"}\n\n' },
	// Digital Employee Template
	{ resource: 'digitalEmployeeTemplate', operation: 'export', params: AGENT, method: 'GET', path: '/digital-employees/template-packs/agents/10' },
	{ resource: 'digitalEmployeeTemplate', operation: 'previewImport', params: { ...AGENT, pack: '{"a":1}', templateOptions: { collision_strategy: 'rename' } }, method: 'POST', path: '/digital-employees/template-packs/preview-import', body: { target_agent_id: 10, pack: { a: 1 }, collision_strategy: 'rename' } },
	{ resource: 'digitalEmployeeTemplate', operation: 'import', params: { pack: '{"a":1}', templateOptions: {} }, method: 'POST', path: '/digital-employees/template-packs/import', body: { pack: { a: 1 } } },
	// Account
	{ resource: 'account', operation: 'getMe', method: 'GET', path: '/me' },
	{ resource: 'account', operation: 'getWorkspaceUsage', params: { ...PAGE, filters: { range: '7d' } }, method: 'GET', path: '/workspaces/usage', qs: { range: '7d', page: 1, per_page: 5 } },
	{ resource: 'account', operation: 'getMissionControlUsage', params: { from: '2026-10-01T00:00:00', to: '2026-10-31T00:00:00', missionOptions: { metrics: ['executions'], filters: '{"modality":["chat"]}' } }, method: 'GET', path: '/mission-control/usage', qs: { from: '2026-10-01', to: '2026-10-31', metrics: ['executions'], filters: { modality: ['chat'] } } },
	{ resource: 'account', operation: 'getAuditEvents', params: { from: '2026-10-01', to: '2026-10-15', ...PAGE, filters: { risk_level: 'high' } }, method: 'GET', path: '/audit-events', qs: { from: '2026-10-01', to: '2026-10-15', risk_level: 'high', limit: 5 } },
];

describe('cada operacao chama o endpoint certo', () => {
	const node = new TessAi();

	it.each(cases.map((c) => [`${c.resource} → ${c.operation}`, c] as const))('%s', async (_name, c) => {
		const { ctx, calls } = fakeContext(
			{ resource: c.resource, operation: c.operation, ...(c.params ?? {}) },
			() => c.response ?? {},
		);
		await node.execute.call(ctx);

		expect(calls.length).toBeGreaterThan(0);
		const call = calls[0];
		expect(call.method).toBe(c.method);
		expect(call.path).toBe(c.path);
		if (c.qs) expect(call.qs).toMatchObject(c.qs);
		if (c.body !== undefined) expect(call.body).toEqual(c.body);
	});

	it('toda operacao declarada na descricao tem um caso de teste', () => {
		const declared = new Set<string>();
		for (const prop of node.description.properties) {
			if (prop.name !== 'operation') continue;
			const resources = (prop.displayOptions?.show?.resource ?? []) as string[];
			for (const option of (prop.options ?? []) as Array<{ value: string }>) {
				for (const resource of resources) declared.add(`${resource}.${option.value}`);
			}
		}
		const tested = new Set(cases.map((c) => `${c.resource}.${c.operation}`));
		const missing = [...declared].filter((d) => !tested.has(d));
		expect(missing).toEqual([]);
	});
});

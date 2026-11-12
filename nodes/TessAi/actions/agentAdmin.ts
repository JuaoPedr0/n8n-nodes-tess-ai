// Recursos Agent Version, Agent Scheduler e Webhook.

import type { IDataObject } from 'n8n-workflow';

import type { HandlerMap } from './common';
import { clean, fieldsFrom, listItems, numericId, request, textId } from './common';

export const agentVersionHandlers: HandlerMap = {
	async getMany(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		return await listItems.call(this, i, `/agents/${agentId}/versions`, {
			mode: 'page',
			keys: ['versions'],
			maxPageSize: 50,
		});
	},

	async get(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const version = numericId.call(this, 'versionNumber', i, 'version number');
		return await request.call(this, 'GET', `/agents/${agentId}/versions/${version}`);
	},

	async rollback(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const version = numericId.call(this, 'versionNumber', i, 'version number');
		return await request.call(this, 'POST', `/agents/${agentId}/versions/${version}/rollback`);
	},
};

/** Converte a data do n8n (ISO) e remove campos que nao fazem sentido vazios. */
function schedulerBody(fields: IDataObject): IDataObject {
	const body = clean(fields);
	if (typeof body.run_once_at === 'string') body.run_once_at = new Date(body.run_once_at).toISOString();
	if (body.agent_root_id_execution === 0) delete body.agent_root_id_execution;
	return body;
}

export const agentSchedulerHandlers: HandlerMap = {
	async getMany(i) {
		const scope = this.getNodeParameter('scope', i, 'all') as string;
		const endpoint =
			scope === 'agent'
				? `/agents/${numericId.call(this, 'agent', i, 'agent ID')}/schedulers`
				: '/schedulers';
		return await listItems.call(this, i, endpoint, { mode: 'page', keys: ['schedulers'] });
	},

	async get(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const schedulerId = textId.call(this, 'schedulerId', i, 'Scheduler ID');
		return await request.call(this, 'GET', `/agents/${agentId}/schedulers/${schedulerId}`);
	},

	async create(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const body = schedulerBody({
			name: this.getNodeParameter('name', i) as string,
			prompt: this.getNodeParameter('prompt', i) as string,
			agent_root_id_execution: this.getNodeParameter('rootExecutionId', i) as number,
			...fieldsFrom.call(this, 'additionalFields', i),
		});
		return await request.call(this, 'POST', `/agents/${agentId}/schedulers`, body);
	},

	async update(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const schedulerId = textId.call(this, 'schedulerId', i, 'Scheduler ID');
		const body = schedulerBody(fieldsFrom.call(this, 'updateFields', i));
		return await request.call(this, 'PUT', `/agents/${agentId}/schedulers/${schedulerId}`, body);
	},

	async delete(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const schedulerId = textId.call(this, 'schedulerId', i, 'Scheduler ID');
		const response = await request.call(
			this,
			'DELETE',
			`/agents/${agentId}/schedulers/${schedulerId}`,
		);
		return { deleted: true, id: Number(schedulerId) || schedulerId, ...response };
	},

	async deleteByRootExecution(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const rootId = numericId.call(this, 'rootExecutionId', i, 'conversation root ID');
		const response = await request.call(
			this,
			'DELETE',
			`/agents/${agentId}/schedulers/by-root-execution/${rootId}`,
		);
		return { deleted: true, agent_id: Number(agentId), root_id: Number(rootId), ...response };
	},
};

export const webhookHandlers: HandlerMap = {
	async getMany(i) {
		const scope = this.getNodeParameter('scope', i, 'all') as string;
		const endpoint =
			scope === 'agent'
				? `/agents/${numericId.call(this, 'agent', i, 'agent ID')}/webhooks`
				: '/webhooks';
		return await listItems.call(this, i, endpoint, { mode: 'page', keys: ['webhooks'] });
	},

	async create(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const body = {
			url: this.getNodeParameter('url', i) as string,
			method: this.getNodeParameter('method', i, 'POST') as string,
			status: this.getNodeParameter('status', i, 'active') as string,
		};
		return await request.call(this, 'POST', `/agents/${agentId}/webhooks`, body);
	},

	async delete(i) {
		const webhookId = textId.call(this, 'webhookId', i, 'Webhook ID');
		const response = await request.call(this, 'DELETE', `/webhooks/${webhookId}`);
		return { deleted: true, id: Number(webhookId) || webhookId, ...response };
	},
};

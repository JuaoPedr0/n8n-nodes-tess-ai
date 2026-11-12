// Recurso Account: usuario do token, uso do workspace, Mission Control e eventos de auditoria.

import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { HandlerMap } from './common';
import { clean, listItems, parseJsonObject, request } from './common';

/** Data do n8n (ISO com hora) → AAAA-MM-DD, como a API pede. */
function day(value: unknown): string | undefined {
	const text = String(value ?? '').trim();
	if (!text) return undefined;
	return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : new Date(text).toISOString().slice(0, 10);
}

export const accountHandlers: HandlerMap = {
	async getMe() {
		return await request.call(this, 'GET', '/me');
	},

	async getWorkspaceUsage(i) {
		const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
		if (filters.start_date) filters.start_date = day(filters.start_date);
		if (filters.end_date) filters.end_date = day(filters.end_date);
		if (!filters.user_id) delete filters.user_id;
		return await listItems.call(this, i, '/workspaces/usage', {
			mode: 'page',
			keys: ['items', 'data.items'],
			qs: filters,
			maxPageSize: 100,
		});
	},

	async getMissionControlUsage(i) {
		const options = clean(this.getNodeParameter('missionOptions', i, {}) as IDataObject);
		const filters = parseJsonObject.call(this, options.filters, i, 'Filters (JSON)');
		delete options.filters;
		for (const key of ['group_by', 'metrics']) {
			if (Array.isArray(options[key]) && !(options[key] as unknown[]).length) delete options[key];
		}
		if (Array.isArray(options.group_by) && options.group_by.length > 3) {
			throw new NodeOperationError(this.getNode(), '"Group By" accepts at most 3 dimensions', {
				itemIndex: i,
			});
		}
		const qs: IDataObject = {
			from: day(this.getNodeParameter('from', i)),
			to: day(this.getNodeParameter('to', i)),
			...options,
		};
		if (filters && Object.keys(filters).length) qs.filters = filters;
		return await request.call(this, 'GET', '/mission-control/usage', undefined, qs);
	},

	async getAuditEvents(i) {
		const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
		if (!filters.actor_id) delete filters.actor_id;
		return await listItems.call(this, i, '/audit-events', {
			mode: 'cursor',
			sizeParam: 'limit',
			maxPageSize: 200,
			qs: {
				from: day(this.getNodeParameter('from', i)),
				to: day(this.getNodeParameter('to', i)),
				...filters,
			},
		});
	},
};

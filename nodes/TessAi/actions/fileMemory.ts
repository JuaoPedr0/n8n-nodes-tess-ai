// Operacoes novas dos recursos File, Memory e Memory Collection
// (as originais continuam em TessAi.node.ts).

import type { IDataObject } from 'n8n-workflow';

import type { HandlerMap } from './common';
import { clean, fieldsFrom, request, textId, withExtraBody } from './common';

export const fileExtraHandlers: HandlerMap = {
	async delete(i) {
		const fileId = textId.call(this, 'fileId', i, 'File ID');
		const response = await request.call(this, 'DELETE', `/files/${fileId}`);
		return { deleted: true, id: Number(fileId) || fileId, ...response };
	},

	async updateVisibility(i) {
		const fileId = textId.call(this, 'fileId', i, 'File ID');
		const visibility = this.getNodeParameter('visibility', i) as string;
		return await request.call(this, 'PATCH', `/files/${fileId}/visibility`, { visibility });
	},

	async resolveReference(i) {
		const ref = String(this.getNodeParameter('reference', i)).trim();
		const options = clean(this.getNodeParameter('resolveOptions', i, {}) as IDataObject);
		if (!options.agent_id) delete options.agent_id;
		return await request.call(this, 'POST', '/files/resolve', { ref, ...options });
	},
};

export const memoryExtraHandlers: HandlerMap = {
	async importFromText(i) {
		const text = this.getNodeParameter('importText', i) as string;
		const options = fieldsFrom.call(this, 'importOptions', i);
		const wait = options.wait === true;
		delete options.wait;
		if (options.collection_id !== undefined) options.collection_id = Number(options.collection_id);
		const body = withExtraBody.call(this, { text, ...options }, i);
		return await request.call(this, 'POST', '/memory-import', body, wait ? { wait: true } : undefined);
	},

	async getImportStatus(i) {
		const id = textId.call(this, 'importId', i, 'Import ID');
		return await request.call(this, 'GET', `/memory-import/${id}`);
	},
};

export const memoryCollectionExtraHandlers: HandlerMap = {
	async getIds(i) {
		const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
		const response = await request.call(this, 'GET', '/memory-collections/ids', undefined, filters);
		const ids = Array.isArray(response) ? response : (response.ids ?? response.data ?? response);
		return { ids } as IDataObject;
	},
};

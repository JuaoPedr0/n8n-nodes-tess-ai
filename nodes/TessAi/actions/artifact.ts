// Recurso Artifact (paginas HTML publicas da Tess).

import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { HandlerMap } from './common';
import { fieldsFrom, listItems, listOrSelf, numericId, parseJson, request, textId } from './common';

const base = (id: string) => `/artifacts/${id}`;

export const artifactHandlers: HandlerMap = {
	async getMany(i) {
		return await listItems.call(this, i, '/artifacts', { mode: 'cursor', maxPageSize: 50 });
	},

	async getTemplates() {
		const response = await request.call(this, 'GET', '/artifact-templates');
		return listOrSelf(response, ['templates']);
	},

	async create(i) {
		const body: IDataObject = {
			title: this.getNodeParameter('title', i) as string,
			content: this.getNodeParameter('content', i) as string,
			...fieldsFrom.call(this, 'additionalFields', i),
		};
		return await request.call(this, 'POST', '/artifacts', body);
	},

	async get(i) {
		return await request.call(this, 'GET', base(textId.call(this, 'artifact', i, 'Artifact')));
	},

	async rename(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		return await request.call(this, 'PATCH', base(id), {
			title: this.getNodeParameter('title', i) as string,
		});
	},

	async delete(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		const response = await request.call(this, 'DELETE', base(id));
		return { deleted: true, universal_id: decodeURIComponent(id), ...response };
	},

	async edit(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		const operations = parseJson.call(this, this.getNodeParameter('operations', i), i, 'Operations');
		if (!Array.isArray(operations) || !operations.length) {
			throw new NodeOperationError(this.getNode(), '"Operations (JSON)" must be a non-empty JSON array', {
				itemIndex: i,
			});
		}
		const baseVersion = this.getNodeParameter('baseVersion', i, 0) as number;
		return await request.call(this, 'POST', `${base(id)}/edit`, {
			operations,
			...(baseVersion > 0 ? { base_version: baseVersion } : {}),
		});
	},

	async publish(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		const version = this.getNodeParameter('version', i, 0) as number;
		return await request.call(this, 'POST', `${base(id)}/publish`, version > 0 ? { version } : {});
	},

	async unpublish(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		return await request.call(this, 'DELETE', `${base(id)}/publish`);
	},

	async restoreVersion(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		const version = Number(numericId.call(this, 'version', i, 'version'));
		return await request.call(this, 'POST', `${base(id)}/restore`, { version });
	},

	async share(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		const changes = ((this.getNodeParameter('access', i, {}) as IDataObject).changes ??
			[]) as IDataObject[];
		const grant: IDataObject[] = [];
		const revoke: IDataObject[] = [];
		for (const change of changes) {
			const target: IDataObject = { type: change.type };
			if (change.type === 'user') {
				if (change.email) target.email = change.email;
				else if (change.user_id) target.user_id = change.user_id;
				else {
					throw new NodeOperationError(this.getNode(), 'A user target needs "User Email" or "User ID"', {
						itemIndex: i,
					});
				}
			}
			if (change.type === 'team') {
				if (!change.team_id) {
					throw new NodeOperationError(this.getNode(), 'A team target needs "Team ID"', {
						itemIndex: i,
					});
				}
				target.team_id = change.team_id;
			}
			(change.action === 'revoke' ? revoke : grant).push(target);
		}
		if (!grant.length && !revoke.length) {
			throw new NodeOperationError(this.getNode(), 'Add at least one access change', { itemIndex: i });
		}
		return await request.call(this, 'POST', `${base(id)}/share`, { grant, revoke });
	},

	async getVersions(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		const response = await request.call(this, 'GET', `${base(id)}/versions`);
		return listOrSelf(response, ['versions']);
	},

	async deleteVersion(i) {
		const id = textId.call(this, 'artifact', i, 'Artifact');
		const version = numericId.call(this, 'version', i, 'version');
		const response = await request.call(this, 'DELETE', `${base(id)}/versions/${version}`);
		return { deleted: true, universal_id: decodeURIComponent(id), version: Number(version), ...response };
	},
};

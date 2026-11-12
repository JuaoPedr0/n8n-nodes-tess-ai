// Recursos Digital Employee, Digital Employee Run e Digital Employee Template.

import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import { deadlineFrom, nextInterval } from '../GenericFunctions';
import type { HandlerMap } from './common';
import {
	clean,
	fieldsFrom,
	listItems,
	numericId,
	parseJsonObject,
	request,
	requestSse,
	textId,
	unwrap,
	withExtraBody,
} from './common';

const base = (id: string) => `/digital-employees/${id}`;
const employeeId = (ctx: IExecuteFunctions, i: number) =>
	numericId.call(ctx, 'employee', i, 'digital employee ID');

const CONFIG_CONVERSIONS = {
	json: [
		'budget_policy_json',
		'delegation_config_json',
		'goal_json',
		'heartbeat_schedule_json',
		'wake_policy_json',
		'work_policy_json',
	],
	texts: ['connectors_json', 'skills_override_json'],
	numbers: ['knowledge_base_file_ids'],
};

/** Status de run que significam "ainda rodando"; qualquer outro encerra a espera. */
const RUN_IN_PROGRESS = ['queued', 'pending', 'starting', 'running', 'in_progress', 'processing'];

async function waitForRun(
	this: IExecuteFunctions,
	id: string,
	run: IDataObject,
	i: number,
	{ timeout, pollInterval }: { timeout: number; pollInterval: number },
): Promise<IDataObject> {
	const deadline = deadlineFrom(timeout);
	let current = run;
	let interval = pollInterval;
	while (RUN_IN_PROGRESS.includes(String(current.status ?? '').toLowerCase())) {
		if (Date.now() >= deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`Run ${current.id} did not finish within the ${timeout}s timeout (status: ${current.status}). Check it later with "Digital Employee Run → Get".`,
				{ itemIndex: i },
			);
		}
		await sleep(Math.min(interval * 1000, Math.max(0, deadline - Date.now())));
		interval = nextInterval(interval, pollInterval);
		current = unwrap(await request.call(this, 'GET', `${base(id)}/runs/${current.id}`), [
			'data.run',
			'run',
			'data',
		]);
	}
	return current;
}

export const digitalEmployeeHandlers: HandlerMap = {
	async getCapabilities() {
		return await request.call(this, 'GET', '/digital-employees/capabilities');
	},

	async getMany(i) {
		const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
		if (!filters.agent_id) delete filters.agent_id;
		return await listItems.call(this, i, '/digital-employees', {
			mode: 'page',
			keys: ['employees', 'data.employees'],
			qs: filters,
		});
	},

	async createStandalone(i) {
		const body = withExtraBody.call(
			this,
			{
				name: this.getNodeParameter('name', i) as string,
				...fieldsFrom.call(this, 'employeeFields', i, CONFIG_CONVERSIONS),
			},
			i,
		);
		return await request.call(this, 'POST', '/digital-employees/standalone', body);
	},

	async createFromAgent(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const body = withExtraBody.call(
			this,
			{
				name: this.getNodeParameter('name', i) as string,
				...fieldsFrom.call(this, 'employeeFields', i, CONFIG_CONVERSIONS),
			},
			i,
		);
		return await request.call(this, 'POST', `/digital-employees/agents/${agentId}`, body);
	},

	async get(i) {
		return await request.call(this, 'GET', base(employeeId(this, i)));
	},

	async update(i) {
		const body = withExtraBody.call(
			this,
			fieldsFrom.call(this, 'employeeFields', i, CONFIG_CONVERSIONS),
			i,
		);
		return await request.call(this, 'PUT', base(employeeId(this, i)), body);
	},

	async duplicate(i) {
		return await request.call(this, 'POST', `${base(employeeId(this, i))}/duplicate`);
	},

	async delete(i) {
		const id = employeeId(this, i);
		const response = await request.call(this, 'DELETE', base(id));
		return { deleted: true, id: Number(id), ...response };
	},

	async previewSchedule(i) {
		const options = fieldsFrom.call(this, 'scheduleOptions', i, {
			json: ['heartbeat_schedule_json'],
		});
		const body = clean({ heartbeat_cron: this.getNodeParameter('heartbeatCron', i, ''), ...options });
		return await request.call(this, 'POST', '/digital-employees/schedule-preview', body);
	},

	async invoke(i) {
		const id = employeeId(this, i);
		const response = await request.call(this, 'POST', `${base(id)}/invoke`, {});
		const run = unwrap(response, ['data.run', 'run', 'data']);
		if (!(this.getNodeParameter('waitForCompletion', i, true) as boolean)) return response;
		if (run.id === undefined) return response;

		const options = this.getNodeParameter('invokeOptions', i, {}) as IDataObject;
		const finished = await waitForRun.call(this, id, run, i, {
			timeout: Number(options.timeout ?? 900),
			pollInterval: Number(options.pollInterval ?? 5),
		});
		let output: IDataObject | undefined;
		try {
			output = unwrap(await request.call(this, 'GET', `${base(id)}/runs/${finished.id}/output`));
		} catch (error) {
			this.logger?.warn(`Tess AI: could not read the output of run ${finished.id}: ${(error as Error).message}`);
		}
		return { ...finished, output: output ?? null, digital_employee_id: Number(id) };
	},

	async pause(i) {
		const reason = String(this.getNodeParameter('reason', i, '')).trim();
		return await request.call(
			this,
			'POST',
			`${base(employeeId(this, i))}/pause`,
			reason ? { reason } : {},
		);
	},

	async resume(i) {
		return await request.call(this, 'POST', `${base(employeeId(this, i))}/resume`);
	},

	async getRollbackOptions(i) {
		return await listItems.call(this, i, `${base(employeeId(this, i))}/rollback-options`, {
			mode: 'single',
			keys: ['options', 'versions', 'data.options', 'data.versions'],
			maxPageSize: 100,
		});
	},

	async rollback(i) {
		const version = this.getNodeParameter('version', i) as number;
		return await request.call(this, 'POST', `${base(employeeId(this, i))}/rollback`, { version });
	},

	async reparent(i) {
		const parent = this.getNodeParameter('parentEmployeeId', i) as number;
		return await request.call(this, 'POST', `${base(employeeId(this, i))}/reparent`, {
			parent_employee_id: parent,
		});
	},

	async detach(i) {
		return await request.call(this, 'POST', `${base(employeeId(this, i))}/detach`);
	},

	async getActivity(i) {
		return await listItems.call(this, i, `${base(employeeId(this, i))}/activity`, {
			mode: 'single',
			keys: ['activity', 'activities', 'events', 'data.activity', 'data.events'],
			maxPageSize: 100,
		});
	},

	async getFiles(i) {
		const response = await request.call(this, 'GET', `${base(employeeId(this, i))}/files`);
		return unwrap(response);
	},

	async updateGoal(i) {
		const body = {
			title: this.getNodeParameter('goalTitle', i) as string,
			...fieldsFrom.call(this, 'goalFields', i),
		};
		return await request.call(this, 'PUT', `${base(employeeId(this, i))}/goal`, body);
	},

	async approve(i) {
		return await request.call(this, 'POST', `${base(employeeId(this, i))}/approve`);
	},

	async reject(i) {
		return await request.call(this, 'POST', `${base(employeeId(this, i))}/reject`);
	},

	async uploadAvatar(i) {
		const field = this.getNodeParameter('binaryPropertyName', i) as string;
		const meta = this.helpers.assertBinaryData(i, field);
		const buffer = await this.helpers.getBinaryDataBuffer(i, field);
		if (buffer.length > 5 * 1024 * 1024) {
			throw new NodeOperationError(this.getNode(), 'The avatar must be up to 5 MB', { itemIndex: i });
		}
		const form = new FormData();
		const bytes = new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
		form.append(
			'avatar',
			new Blob([bytes], { type: meta.mimeType || 'image/png' }),
			meta.fileName || 'avatar.png',
		);
		const name = String(this.getNodeParameter('avatarName', i, '')).trim();
		if (name) form.append('name', name);
		return await request.call(this, 'POST', '/digital-employees/avatar-upload', form);
	},
};

export const digitalEmployeeRunHandlers: HandlerMap = {
	async getMany(i) {
		const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
		return await listItems.call(this, i, `${base(employeeId(this, i))}/runs`, {
			mode: 'offset',
			keys: ['runs', 'data.runs'],
			qs: filters,
			maxPageSize: 100,
		});
	},

	async get(i) {
		const runId = textId.call(this, 'runId', i, 'Run ID');
		return await request.call(this, 'GET', `${base(employeeId(this, i))}/runs/${runId}`);
	},

	async getOutput(i) {
		const runId = textId.call(this, 'runId', i, 'Run ID');
		return await request.call(this, 'GET', `${base(employeeId(this, i))}/runs/${runId}/output`);
	},

	async getSummary(i) {
		return await request.call(this, 'GET', `${base(employeeId(this, i))}/runs/summary`);
	},

	async retry(i) {
		const runId = textId.call(this, 'runId', i, 'Run ID');
		return await request.call(this, 'POST', `${base(employeeId(this, i))}/runs/${runId}/retry`);
	},

	async stream(i) {
		const id = employeeId(this, i);
		const runId = textId.call(this, 'runId', i, 'Run ID');
		const timeout = this.getNodeParameter('timeout', i, 900) as number;
		const deadline = deadlineFrom(timeout);
		const events = await requestSse.call(
			this,
			'GET',
			`${base(id)}/runs/${runId}/stream`,
			undefined,
			Number.isFinite(deadline) ? deadline - Date.now() : undefined,
		);
		let output = '';
		let complete: IDataObject | undefined;
		for (const { event, data } of events) {
			if (event === 'complete') {
				complete = (data && typeof data === 'object' ? data : { output: data }) as IDataObject;
				continue;
			}
			if (typeof data === 'string') output += data;
			else if (data && typeof data === 'object') {
				const chunk = data as IDataObject;
				const text = chunk.delta ?? chunk.output ?? chunk.text ?? chunk.content;
				if (typeof text === 'string') output += text;
			}
		}
		return {
			run_id: Number(runId) || runId,
			digital_employee_id: Number(id),
			streamed_output: output,
			events: events.length,
			...(complete ?? {}),
		};
	},
};

export const digitalEmployeeTemplateHandlers: HandlerMap = {
	async export(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		return await request.call(this, 'GET', `/digital-employees/template-packs/agents/${agentId}`);
	},

	async previewImport(i) {
		const agentId = Number(numericId.call(this, 'agent', i, 'agent ID'));
		const pack = parseJsonObject.call(this, this.getNodeParameter('pack', i), i, 'Template Pack');
		const options = fieldsFrom.call(this, 'templateOptions', i);
		delete options.target_agent_id;
		return await request.call(this, 'POST', '/digital-employees/template-packs/preview-import', {
			target_agent_id: agentId,
			pack: pack ?? {},
			...options,
		});
	},

	async import(i) {
		const pack = parseJsonObject.call(this, this.getNodeParameter('pack', i), i, 'Template Pack');
		const options = fieldsFrom.call(this, 'templateOptions', i);
		if (!options.target_agent_id) delete options.target_agent_id;
		return await request.call(this, 'POST', '/digital-employees/template-packs/import', {
			pack: pack ?? {},
			...options,
		});
	},
};


// Operacoes do recurso Agent alem das originais (getMany, get, linkFiles, execute ficam em TessAi.node.ts).

import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { HandlerMap } from './common';
import { clean, listOrSelf, numericId, request, requestSse, textId, withExtraBody } from './common';

export const agentExtraHandlers: HandlerMap = {
	async chatCompletion(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const collection = this.getNodeParameter('chatMessages', i, {}) as IDataObject;
		const messages = ((collection.messages as IDataObject[] | undefined) ?? [])
			.filter((m) => String(m.content ?? '').trim())
			.map((m) => ({ role: m.role ?? 'user', content: m.content }));
		if (!messages.length) {
			throw new NodeOperationError(this.getNode(), 'Add at least one message with content', {
				itemIndex: i,
			});
		}
		const options = clean(this.getNodeParameter('chatOptions', i, {}) as IDataObject);
		const body = withExtraBody.call(this, { messages, ...options, stream: false }, i);
		const response = await request.call(
			this,
			'POST',
			`/agents/${agentId}/openai/chat/completions`,
			body,
		);
		if (!(this.getNodeParameter('simplify', i, true) as boolean)) return response;

		const choice = ((response.choices as IDataObject[] | undefined) ?? [])[0] ?? {};
		const message = (choice.message as IDataObject | undefined) ?? {};
		return {
			id: response.id,
			model: response.model,
			content: message.content ?? '',
			role: message.role ?? 'assistant',
			finish_reason: choice.finish_reason,
			usage: response.usage,
			agent_id: Number(agentId),
		};
	},

	async listFiles(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const response = await request.call(this, 'GET', `/agents/${agentId}/files`);
		return listOrSelf(response, ['files']);
	},

	async unlinkFile(i) {
		const agentId = numericId.call(this, 'agent', i, 'agent ID');
		const fileId = textId.call(this, 'fileId', i, 'File ID');
		const response = await request.call(this, 'DELETE', `/agents/${agentId}/files/${fileId}`);
		return { unlinked: true, agent_id: Number(agentId), file_id: Number(fileId) || fileId, ...response };
	},
};

/**
 * Executa um agente de chat com `stream: true` e junta os eventos SSE numa resposta com o mesmo
 * formato do polling (`id`, `status`, `output`, `credits`, `root_id`...).
 */
export async function streamAgentExecution(
	this: IExecuteFunctions,
	agentId: string,
	body: IDataObject,
	itemIndex: number,
	deadline: number,
): Promise<IDataObject> {
	const requestBody: IDataObject = { ...body, stream: true };
	delete requestBody.waitExecution;
	const events = await requestSse.call(
		this,
		'POST',
		`/agents/${agentId}/execute`,
		requestBody,
		Number.isFinite(deadline) ? deadline - Date.now() : undefined,
	);

	let output = '';
	let last: IDataObject = {};
	for (const { data } of events) {
		if (!data || typeof data !== 'object') continue;
		const event = data as IDataObject;
		if (typeof event.output === 'string') output += event.output;
		last = { ...last, ...event };
		if (event.error) {
			throw new NodeOperationError(
				this.getNode(),
				`Agent execution ${event.id ?? ''} failed while streaming`,
				{
					itemIndex,
					description: typeof event.error === 'string' ? event.error : JSON.stringify(event.error),
				},
			);
		}
	}
	if (!events.length || last.id === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			'Tess returned no stream events. Streaming works only with chat agents — turn off "Stream Response" for other agent types.',
			{ itemIndex },
		);
	}
	return { ...last, output, streamed: true };
}

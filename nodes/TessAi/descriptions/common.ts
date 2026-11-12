import type { INodeProperties } from 'n8n-workflow';

/** displayOptions para um recurso e suas operacoes. */
export const showFor = (resource: string, operation: string[], extra: Record<string, unknown[]> = {}) => ({
	show: { resource: [resource], operation, ...extra },
});

/** Return All + Limit (o handler usa listItems). */
export function returnAllAndLimit(
	resource: string,
	operation: string[],
	extra: Record<string, unknown[]> = {},
): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: showFor(resource, operation, extra),
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: showFor(resource, operation, { ...extra, returnAll: [false] }),
		},
	];
}

/** Agente: lista pesquisavel, ID ou URL (mesmo formato do recurso Agent). */
export function agentLocator(
	displayOptions: INodeProperties['displayOptions'],
	overrides: Partial<INodeProperties> = {},
): INodeProperties {
	return {
		displayName: 'Agent',
		name: 'agent',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The agent to use',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchAgents', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: '8794',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^[0-9]+$', errorMessage: 'The agent ID is a number' },
					},
				],
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				placeholder: 'https://app.tess.im/ai-studio/agents/8794',
				extractValue: { type: 'regex', regex: '/agents?/([0-9]+)' },
			},
		],
		displayOptions,
		...overrides,
	};
}

export function employeeLocator(
	displayOptions: INodeProperties['displayOptions'],
	overrides: Partial<INodeProperties> = {},
): INodeProperties {
	return {
		displayName: 'Digital Employee',
		name: 'employee',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The digital employee to use',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchDigitalEmployees', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: '123',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^[0-9]+$', errorMessage: 'The digital employee ID is a number' },
					},
				],
			},
		],
		displayOptions,
		...overrides,
	};
}

export function artifactLocator(displayOptions: INodeProperties['displayOptions']): INodeProperties {
	return {
		displayName: 'Artifact',
		name: 'artifact',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The artifact (public page) to use',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchArtifacts', searchable: true },
			},
			{
				displayName: 'Universal ID',
				name: 'id',
				type: 'string',
				placeholder: 'art_4f2c1a9e',
			},
		],
		displayOptions,
	};
}

/** Campo JSON livre que e mesclado no corpo da requisicao. */
export function extraBodyField(displayOptions: INodeProperties['displayOptions']): INodeProperties {
	return {
		displayName: 'Additional Body (JSON)',
		name: 'extraBody',
		type: 'json',
		default: '',
		description:
			'Extra fields sent in the request body, as a JSON object. They override the fields above. Use it for API fields this node does not list yet.',
		displayOptions,
	};
}

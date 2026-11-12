import type { INodeProperties } from 'n8n-workflow';

import { agentLocator, returnAllAndLimit, showFor } from './common';

const R = 'agentVersion';

export const agentVersionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a published version of an agent, including its snapshot',
				action: 'Get an agent version',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List the published versions of an agent',
				action: 'Get many agent versions',
			},
			{
				name: 'Rollback',
				value: 'rollback',
				description: 'Make an earlier version the active one (creates a new published version)',
				action: 'Rollback an agent to a version',
			},
		],
		default: 'getMany',
	},
];

export const agentVersionFields: INodeProperties[] = [
	agentLocator(showFor(R, ['get', 'getMany', 'rollback'])),
	{
		displayName: 'Version Number',
		name: 'versionNumber',
		type: 'number',
		typeOptions: { minValue: 1 },
		required: true,
		default: 1,
		displayOptions: showFor(R, ['get', 'rollback']),
	},
	...returnAllAndLimit(R, ['getMany']),
];

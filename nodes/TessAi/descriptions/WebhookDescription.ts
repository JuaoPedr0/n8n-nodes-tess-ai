import type { INodeProperties } from 'n8n-workflow';

import { agentLocator, returnAllAndLimit, showFor } from './common';

const R = 'webhook';

export const webhookOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Register a URL that Tess calls for an agent',
				action: 'Create a webhook',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a webhook',
				action: 'Delete a webhook',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List webhooks of all agents or of one agent',
				action: 'Get many webhooks',
			},
		],
		default: 'getMany',
	},
];

export const webhookFields: INodeProperties[] = [
	{
		displayName: 'Scope',
		name: 'scope',
		type: 'options',
		options: [
			{ name: 'All Agents', value: 'all' },
			{ name: 'One Agent', value: 'agent' },
		],
		default: 'all',
		displayOptions: showFor(R, ['getMany']),
	},
	agentLocator(showFor(R, ['getMany'], { scope: ['agent'] })),
	agentLocator(showFor(R, ['create'])),
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://n8n.mycompany.com/webhook/tess',
		description: 'URL that receives the notifications',
		displayOptions: showFor(R, ['create']),
	},
	{
		displayName: 'Method',
		name: 'method',
		type: 'options',
		options: [
			{ name: 'GET', value: 'GET' },
			{ name: 'PATCH', value: 'PATCH' },
			{ name: 'POST', value: 'POST' },
			{ name: 'PUT', value: 'PUT' },
		],
		default: 'POST',
		description: 'HTTP method Tess uses to call the URL',
		displayOptions: showFor(R, ['create']),
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		options: [
			{ name: 'Active', value: 'active' },
			{ name: 'Inactive', value: 'inactive' },
		],
		default: 'active',
		displayOptions: showFor(R, ['create']),
	},
	{
		displayName: 'Webhook ID',
		name: 'webhookId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(R, ['delete']),
	},
	...returnAllAndLimit(R, ['getMany']),
];

import type { INodeProperties } from 'n8n-workflow';

const showFor = (operation: string[]) => ({ show: { resource: ['agentResponse'], operation } });

export const agentResponseOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['agentResponse'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get an agent execution (status and output)',
				action: 'Get an agent response',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List agent executions',
				action: 'Get many agent responses',
			},
		],
		default: 'get',
	},
];

export const agentResponseFields: INodeProperties[] = [
	{
		displayName: 'Response ID',
		name: 'responseId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '4773337',
		description: 'ID of the agent execution, returned by "Agent → Execute"',
		displayOptions: showFor(['get']),
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: showFor(['getMany']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['agentResponse'], operation: ['getMany'], returnAll: [false] },
		},
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(['getMany']),
		options: [
			{
				displayName: 'Agent ID',
				name: 'agent_id',
				type: 'number',
				default: 0,
				description: 'Only executions of this agent',
			},
			{
				displayName: 'Root ID',
				name: 'root_id',
				type: 'number',
				default: 0,
				description: 'Only executions of this conversation thread',
			},
			{
				displayName: 'Search',
				name: 'q',
				type: 'string',
				default: '',
				description: 'Search by agent title',
			},
			{
				displayName: 'Sort',
				name: 'sort',
				type: 'options',
				default: 'desc',
				options: [
					{ name: 'Newest First', value: 'desc' },
					{ name: 'Oldest First', value: 'asc' },
				],
			},
		],
	},
];

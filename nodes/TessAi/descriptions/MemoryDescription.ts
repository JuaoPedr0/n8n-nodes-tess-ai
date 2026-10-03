import type { INodeProperties } from 'n8n-workflow';

const showFor = (operation: string[]) => ({ show: { resource: ['memory'], operation } });

export const memoryOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['memory'] } },
		options: [
			{ name: 'Create', value: 'create', description: 'Store a memory', action: 'Create a memory' },
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List memories',
				action: 'Get many memories',
			},
		],
		default: 'create',
	},
];

export const memoryFields: INodeProperties[] = [
	{
		displayName: 'Memory',
		name: 'memory',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Content to remember (up to 32,000 characters)',
		displayOptions: showFor(['create']),
	},
	{
		displayName: 'Collection Name or ID',
		name: 'collectionId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getMemoryCollections' },
		default: '',
		description:
			'Collection to store the memory in. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: showFor(['create']),
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
		displayOptions: { show: { resource: ['memory'], operation: ['getMany'], returnAll: [false] } },
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
				displayName: 'Collection Name or ID',
				name: 'collection_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getMemoryCollections' },
				default: '',
				description:
					'Only memories of this collection. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

export const memoryCollectionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['memoryCollection'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List memory collections',
				action: 'Get many memory collections',
			},
		],
		default: 'getMany',
	},
];

export const memoryCollectionFields: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['memoryCollection'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['memoryCollection'], operation: ['getMany'], returnAll: [false] },
		},
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['memoryCollection'], operation: ['getMany'] } },
		options: [
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Filter collections by name',
			},
		],
	},
];

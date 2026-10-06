import type { INodeProperties } from 'n8n-workflow';

const showFor = (operation: string[]) => ({ show: { resource: ['memory'], operation } });
const showCollectionFor = (operation: string[]) => ({
	show: { resource: ['memoryCollection'], operation },
});

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
				name: 'Delete',
				value: 'delete',
				description: 'Delete a memory',
				action: 'Delete a memory',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List memories',
				action: 'Get many memories',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Replace the content of a memory and optionally move it to another collection',
				action: 'Update a memory',
			},
		],
		default: 'create',
	},
];

export const memoryFields: INodeProperties[] = [
	{
		displayName: 'Memory ID',
		name: 'memoryId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '10',
		displayOptions: showFor(['update', 'delete']),
	},
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
		displayName: 'Memory',
		name: 'memory',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description:
			'New content of the memory (up to 32,000 characters). The Tess API requires it even when only the collection changes.',
		displayOptions: showFor(['update']),
	},
	{
		displayName: 'Collection Name or ID',
		name: 'collectionId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getMemoryCollections' },
		default: '',
		description:
			'Collection to store the memory in (empty = default collection). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: showFor(['create']),
	},
	{
		displayName: 'Collection Name or ID',
		name: 'collectionId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getMemoryCollections' },
		default: '',
		description:
			'Collection to move the memory to (empty = keep the current collection). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: showFor(['update']),
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
				name: 'Create',
				value: 'create',
				description: 'Create a memory collection',
				action: 'Create a memory collection',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a memory collection and all its memories',
				action: 'Delete a memory collection',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List memory collections',
				action: 'Get many memory collections',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Rename a memory collection',
				action: 'Update a memory collection',
			},
		],
		default: 'getMany',
	},
];

export const memoryCollectionFields: INodeProperties[] = [
	{
		displayName: 'Collection Name or ID',
		name: 'collectionId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getMemoryCollections' },
		required: true,
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: showCollectionFor(['update', 'delete']),
	},
	{
		displayName:
			'Deleting a collection also deletes all of its memories. The default collection cannot be deleted.',
		name: 'deleteNotice',
		type: 'notice',
		default: '',
		displayOptions: showCollectionFor(['delete']),
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Contratos',
		displayOptions: showCollectionFor(['create', 'update']),
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: showCollectionFor(['getMany']),
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
		displayOptions: showCollectionFor(['getMany']),
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

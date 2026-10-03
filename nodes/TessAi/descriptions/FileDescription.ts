import type { INodeProperties } from 'n8n-workflow';

const showFor = (operation: string[]) => ({ show: { resource: ['file'], operation } });

export const fileOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get a file', action: 'Get a file' },
			{ name: 'Get Many', value: 'getMany', description: 'List files', action: 'Get many files' },
			{
				name: 'Process',
				value: 'process',
				description:
					'Extract the content of an uploaded file so agents can use it (consumes credits)',
				action: 'Process a file',
			},
			{
				name: 'Upload',
				value: 'upload',
				description: 'Upload a file (up to 32 MB)',
				action: 'Upload a file',
			},
		],
		default: 'upload',
	},
];

export const fileFields: INodeProperties[] = [
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the file to upload',
		displayOptions: showFor(['upload']),
	},
	{
		displayName: 'Process After Upload',
		name: 'process',
		type: 'boolean',
		default: true,
		description:
			'Whether to process the file right after upload so it can be used by agents (consumes credits)',
		displayOptions: showFor(['upload']),
	},
	{
		displayName: 'File ID',
		name: 'fileId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '73325',
		displayOptions: showFor(['get', 'process']),
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
		displayOptions: { show: { resource: ['file'], operation: ['getMany'], returnAll: [false] } },
	},
	{
		displayName: 'Order',
		name: 'order',
		type: 'options',
		default: 'desc',
		options: [
			{ name: 'Newest First', value: 'desc' },
			{ name: 'Oldest First', value: 'asc' },
		],
		displayOptions: showFor(['getMany']),
	},
];

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
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a file from the workspace',
				action: 'Delete a file',
			},
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
				name: 'Resolve Reference',
				value: 'resolveReference',
				description: 'Turn a durable doc:// file reference into a short-lived download URL',
				action: 'Resolve a file reference',
			},
			{
				name: 'Update Visibility',
				value: 'updateVisibility',
				description: 'Set who can see a file: only its owner, the workspace or anyone with the link',
				action: 'Update the visibility of a file',
			},
			{
				name: 'Upload',
				value: 'upload',
				description: 'Upload a file (up to 200 MB)',
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
	// v1 = nodes criados até a 0.2.x (não esperavam o processamento); v1.1+ espera por padrão
	{
		displayName: 'Wait for Processing',
		name: 'waitForProcessing',
		type: 'boolean',
		default: false,
		description:
			'Whether to wait until Tess finishes processing the file (status "completed") before continuing',
		displayOptions: {
			show: { resource: ['file'], operation: ['upload'], process: [true], '@version': [1] },
		},
	},
	{
		displayName: 'Wait for Processing',
		name: 'waitForProcessing',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until Tess finishes processing the file (status "completed") before continuing',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['upload'],
				process: [true],
				'@version': [{ _cnd: { gte: 1.1 } }],
			},
		},
	},
	{
		displayName: 'Processing Timeout (Seconds)',
		name: 'processingTimeout',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 600,
		description: 'Maximum time to wait for the processing. 0 = no limit.',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['upload'],
				process: [true],
				waitForProcessing: [true],
			},
		},
	},
	{
		displayName: 'File ID',
		name: 'fileId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '73325',
		displayOptions: showFor(['delete', 'get', 'process', 'updateVisibility']),
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

	// ---------------- process ----------------
	{
		displayName: 'Processing Mode',
		name: 'processMode',
		type: 'options',
		options: [
			{
				name: 'Wait (Sync)',
				value: 'sync',
				description: 'Tess holds the request until the file is processed (up to 5 minutes)',
			},
			{
				name: 'Start Only (Async)',
				value: 'async',
				description: 'Start processing and return at once; follow it with "File → Get"',
			},
		],
		default: 'sync',
		displayOptions: showFor(['process']),
	},

	// ---------------- updateVisibility ----------------
	{
		displayName: 'Visibility',
		name: 'visibility',
		type: 'options',
		required: true,
		options: [
			{ name: 'Private (Owner Only)', value: 'private' },
			{ name: 'Public (Anyone With the Link)', value: 'public' },
			{ name: 'Workspace', value: 'workspace' },
		],
		default: 'workspace',
		displayOptions: showFor(['updateVisibility']),
	},

	// ---------------- resolveReference ----------------
	{
		displayName: 'Reference',
		name: 'reference',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'doc://file_4f2c1a9e-...',
		description: 'Durable reference returned by Tess as "ref_url"',
		displayOptions: showFor(['resolveReference']),
	},
	{
		displayName: 'Options',
		name: 'resolveOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['resolveReference']),
		options: [
			{
				displayName: 'Agent ID',
				name: 'agent_id',
				type: 'number',
				default: 0,
				description:
					'Agent being executed, when known. Lets a public-embed session resolve a private file from that agent knowledge base.',
			},
		],
	},
];

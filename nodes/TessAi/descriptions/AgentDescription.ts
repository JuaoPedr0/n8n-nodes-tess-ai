import type { INodeProperties } from 'n8n-workflow';

const showFor = (operation: string[]) => ({ show: { resource: ['agent'], operation } });

export const agentOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['agent'] } },
		options: [
			{
				name: 'Execute',
				value: 'execute',
				description: 'Run an agent and return its response',
				action: 'Execute an agent',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get an agent, including its input fields',
				action: 'Get an agent',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List agents',
				action: 'Get many agents',
			},
			{
				name: 'Link Files',
				value: 'linkFiles',
				description: 'Link uploaded files to an agent as knowledge',
				action: 'Link files to an agent',
			},
		],
		default: 'execute',
	},
];

const agentLocator: INodeProperties = {
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
};

export const agentFields: INodeProperties[] = [
	{ ...agentLocator, displayOptions: showFor(['execute', 'get', 'linkFiles']) },

	// ---------------- execute ----------------
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		placeholder: 'e.g. Summarize the attached contract',
		description:
			'User message sent to the agent (chat agents). Leave empty for agents that only use input fields.',
		displayOptions: showFor(['execute']),
	},
	{
		displayName: 'Agent Inputs',
		name: 'inputs',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		description: 'Values for the input fields defined by the agent',
		typeOptions: {
			loadOptionsDependsOn: ['agent.value'],
			resourceMapper: {
				resourceMapperMethod: 'getAgentInputs',
				mode: 'add',
				fieldWords: { singular: 'input', plural: 'inputs' },
				addAllFields: true,
				supportAutoMap: false,
				hideNoDataError: true,
			},
		},
		displayOptions: showFor(['execute']),
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until the agent finishes and return its output. If disabled, returns the execution ID immediately (status "starting").',
		displayOptions: showFor(['execute']),
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['execute']),
		options: [
			{
				displayName: 'Continue Conversation (Root ID)',
				name: 'rootId',
				type: 'number',
				default: 0,
				description:
					'Continues a conversation stored by Tess: use the "root_id" returned by a previous execution. Tess already keeps the history, so you do not need "Previous Messages".',
			},
			{
				displayName: 'File IDs',
				name: 'fileIds',
				type: 'string',
				default: '',
				placeholder: '123, 456',
				description: 'Comma-separated IDs of uploaded files to attach to this execution',
			},
			{
				displayName: 'Memory Collection IDs',
				name: 'memoryCollections',
				type: 'string',
				default: '',
				placeholder: '12, 34',
				description: 'Comma-separated memory collection IDs used as context',
			},
			{
				displayName: 'Model Name or ID',
				name: 'model',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAgentModels', loadOptionsDependsOn: ['agent.value'] },
				default: '',
				description:
					'Models allowed by the selected agent. Empty uses the agent default. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Poll Interval (Seconds)',
				name: 'pollInterval',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 3,
				description: 'How often to check the execution status while waiting',
			},
			{
				displayName: 'Previous Messages',
				name: 'history',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				placeholder: 'Add Message',
				default: {},
				description:
					'Earlier turns of a conversation that Tess does not know yet (e.g. a chat kept in another system). They are sent before "Message".',
				options: [
					{
						displayName: 'Message',
						name: 'messages',
						values: [
							{
								displayName: 'Role',
								name: 'role',
								type: 'options',
								options: [
									{ name: 'User', value: 'user' },
									{ name: 'Assistant', value: 'assistant' },
								],
								default: 'user',
							},
							{
								displayName: 'Content',
								name: 'content',
								type: 'string',
								typeOptions: { rows: 2 },
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Previous Messages (JSON)',
				name: 'messages',
				type: 'json',
				default: '[]',
				description:
					'Same as "Previous Messages", but as a JSON array — useful with an expression that returns the history from a previous node. Format: [{"role":"user","content":"..."},{"role":"assistant","content":"..."}].',
			},
			{
				displayName: 'Temperature Name or ID',
				name: 'temperature',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getAgentTemperatures',
					loadOptionsDependsOn: ['agent.value'],
				},
				default: '',
				description:
					'Lower is more objective, higher is more creative. Values allowed by the selected agent; empty uses the agent default. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				typeOptions: { minValue: 10 },
				default: 600,
				description: 'Maximum time to wait for the agent to finish',
			},
			{
				displayName: 'Tool Name or ID',
				name: 'tools',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAgentTools', loadOptionsDependsOn: ['agent.value'] },
				default: '',
				description:
					'Tool the agent may use in this execution (one per execution). Empty uses the agent default. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},

	// ---------------- getMany ----------------
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
		displayOptions: { show: { resource: ['agent'], operation: ['getMany'], returnAll: [false] } },
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
				displayName: 'Search',
				name: 'q',
				type: 'string',
				default: '',
				description: 'Search agents by title and description',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'chat',
				options: [
					{ name: 'Chat', value: 'chat' },
					{ name: 'Image', value: 'image' },
					{ name: 'Text', value: 'text' },
					{ name: 'Video', value: 'video' },
				],
			},
		],
	},

	// ---------------- linkFiles ----------------
	{
		displayName: 'File IDs',
		name: 'fileIds',
		type: 'string',
		required: true,
		default: '',
		placeholder: '123, 456',
		description: 'Comma-separated IDs of uploaded files to link to the agent',
		displayOptions: showFor(['linkFiles']),
	},
];

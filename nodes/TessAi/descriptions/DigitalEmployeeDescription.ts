import type { INodeProperties } from 'n8n-workflow';

import { agentLocator, employeeLocator, extraBodyField, returnAllAndLimit, showFor } from './common';

const R = 'digitalEmployee';
const RUN = 'digitalEmployeeRun';
const TPL = 'digitalEmployeeTemplate';

// ---------------------------------------------------------------------------
// Digital Employee
// ---------------------------------------------------------------------------

export const digitalEmployeeOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		options: [
			{
				name: 'Approve Hire Request',
				value: 'approve',
				description: 'Approve a digital employee waiting for approval',
				action: 'Approve a digital employee',
			},
			{
				name: 'Create From Agent',
				value: 'createFromAgent',
				description: 'Create a digital employee linked to an existing agent',
				action: 'Create a digital employee from an agent',
			},
			{
				name: 'Create Standalone',
				value: 'createStandalone',
				description: 'Create a digital employee with a new host agent',
				action: 'Create a standalone digital employee',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a digital employee',
				action: 'Delete a digital employee',
			},
			{
				name: 'Detach From Parent',
				value: 'detach',
				description: 'Make the digital employee a top-level employee',
				action: 'Detach a digital employee from its parent',
			},
			{
				name: 'Duplicate',
				value: 'duplicate',
				description: 'Create a copy of a digital employee',
				action: 'Duplicate a digital employee',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a digital employee with its main relations',
				action: 'Get a digital employee',
			},
			{
				name: 'Get Activity',
				value: 'getActivity',
				description: 'Get the activity log of a digital employee',
				action: 'Get the activity of a digital employee',
			},
			{
				name: 'Get Capabilities',
				value: 'getCapabilities',
				description: 'Get what the current user can do with digital employees in the workspace',
				action: 'Get the digital employee capabilities',
			},
			{
				name: 'Get Files',
				value: 'getFiles',
				description: 'Get the files of the most recent run',
				action: 'Get the files of a digital employee',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List the digital employees of the workspace',
				action: 'Get many digital employees',
			},
			{
				name: 'Get Rollback Options',
				value: 'getRollbackOptions',
				description: 'List the versions a digital employee can be rolled back to',
				action: 'Get the rollback options of a digital employee',
			},
			{
				name: 'Invoke',
				value: 'invoke',
				description: 'Start a manual run, optionally waiting for its output',
				action: 'Invoke a digital employee',
			},
			{
				name: 'Pause',
				value: 'pause',
				description: 'Stop new scheduled runs from starting',
				action: 'Pause a digital employee',
			},
			{
				name: 'Preview Schedule',
				value: 'previewSchedule',
				description: 'Validate a schedule and return the next planned runs',
				action: 'Preview a digital employee schedule',
			},
			{
				name: 'Reject Hire Request',
				value: 'reject',
				description: 'Reject a digital employee waiting for approval',
				action: 'Reject a digital employee',
			},
			{
				name: 'Reparent',
				value: 'reparent',
				description: 'Make the digital employee a child of another employee',
				action: 'Reparent a digital employee',
			},
			{
				name: 'Resume',
				value: 'resume',
				description: 'Re-enable scheduled runs of a paused digital employee',
				action: 'Resume a digital employee',
			},
			{
				name: 'Rollback',
				value: 'rollback',
				description: 'Restore a digital employee to a previous version',
				action: 'Rollback a digital employee',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update fields of a digital employee',
				action: 'Update a digital employee',
			},
			{
				name: 'Update Goal',
				value: 'updateGoal',
				description: 'Set or update the goal of a digital employee',
				action: 'Update the goal of a digital employee',
			},
			{
				name: 'Upload Avatar',
				value: 'uploadAvatar',
				description: 'Upload an avatar image (up to 5 MB) to use on a digital employee',
				action: 'Upload a digital employee avatar',
			},
		],
		default: 'getMany',
	},
];

/** Campos de configuracao aceitos na criacao e na atualizacao (nomes da API). */
const configFields = (forUpdate: boolean): INodeProperties[] => {
	const fields: INodeProperties[] = [
		{ displayName: 'Avatar URL', name: 'avatar', type: 'string', default: '' },
		{ displayName: 'Avatar Thumbnail URL', name: 'avatar_thumbnail', type: 'string', default: '' },
		{
			displayName: 'Budget Policy (JSON)',
			name: 'budget_policy_json',
			type: 'json',
			default: '{}',
		},
		{
			displayName: 'Connectors',
			name: 'connectors_json',
			type: 'string',
			default: '',
			placeholder: 'googlesheets, slack',
			description: 'Comma-separated connector slugs',
		},
		{
			displayName: 'Default Interval (Seconds)',
			name: 'default_interval_seconds',
			type: 'number',
			default: 0,
		},
		...(forUpdate
			? [
					{
						displayName: 'Delegation Config (JSON)',
						name: 'delegation_config_json',
						type: 'json',
						default: '{}',
					} as INodeProperties,
				]
			: []),
		{
			displayName: 'Execution Approval Mode',
			name: 'execution_approval_mode',
			type: 'options',
			options: [
				{ name: 'Approval Required', value: 'approval_required' },
				{ name: 'Autonomous', value: 'autonomous' },
			],
			default: 'autonomous',
		},
		{
			displayName: 'Execution Mode',
			name: 'execution_mode',
			type: 'options',
			options: [
				{ name: 'Agent', value: 'agent' },
				{ name: 'Chat', value: 'chat' },
			],
			default: 'agent',
		},
		{
			displayName: 'Execution Order',
			name: 'execution_order',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 999 },
			default: 0,
		},
		{ displayName: 'Goal (JSON)', name: 'goal_json', type: 'json', default: '{}' },
		{
			displayName: 'Heartbeat Cron',
			name: 'heartbeat_cron',
			type: 'string',
			default: '',
			placeholder: '0 9 * * 1-5',
			description: 'When the employee wakes up on its own (cron)',
		},
		{
			displayName: 'Heartbeat Schedule (JSON)',
			name: 'heartbeat_schedule_json',
			type: 'json',
			default: '{}',
		},
		...(forUpdate
			? []
			: [
					{
						displayName: 'Knowledge Base File IDs',
						name: 'knowledge_base_file_ids',
						type: 'string',
						default: '',
						placeholder: '123, 456',
						description: 'Comma-separated IDs of uploaded files',
					} as INodeProperties,
				]),
		{
			displayName: 'Max Consecutive Failures',
			name: 'max_consecutive_failures',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 100 },
			default: 3,
		},
		{
			displayName: 'Model Override',
			name: 'model_override',
			type: 'string',
			default: '',
			placeholder: 'tess-6',
			description: 'API model slug',
		},
		...(forUpdate
			? [{ displayName: 'Name', name: 'name', type: 'string', default: '' } as INodeProperties]
			: []),
		{ displayName: 'Personality Type', name: 'personality_type', type: 'string', default: '' },
		{
			displayName: 'Search Intelligence',
			name: 'search_intelligence_enabled',
			type: 'boolean',
			default: false,
			description: 'Whether the employee may search the web',
		},
		{
			displayName: 'Share Memory With Owner',
			name: 'share_memory_with_owner',
			type: 'boolean',
			default: false,
			description: 'Whether the employee shares its memories with its owner',
		},
		{
			displayName: 'Skills Override',
			name: 'skills_override_json',
			type: 'string',
			default: '',
			description: 'Comma-separated skill slugs',
		},
		...(forUpdate
			? [
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Active', value: 'active' },
							{ name: 'Idle', value: 'idle' },
						],
						default: 'active',
					} as INodeProperties,
				]
			: []),
		{
			displayName: 'System Prompt Override',
			name: 'system_prompt_override',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
		},
		{
			displayName: 'Timezone',
			name: 'execution_timezone',
			type: 'string',
			default: '',
			placeholder: 'America/Sao_Paulo',
		},
		{ displayName: 'Tools Override', name: 'tools_override', type: 'string', default: '' },
		{ displayName: 'Voice', name: 'voice_realtime_voice', type: 'string', default: '' },
		{ displayName: 'Wake Policy (JSON)', name: 'wake_policy_json', type: 'json', default: '{}' },
		{ displayName: 'Work Policy (JSON)', name: 'work_policy_json', type: 'json', default: '{}' },
	];
	return fields;
};

export const digitalEmployeeFields: INodeProperties[] = [
	employeeLocator(
		showFor(R, [
			'approve',
			'delete',
			'detach',
			'duplicate',
			'get',
			'getActivity',
			'getFiles',
			'getRollbackOptions',
			'invoke',
			'pause',
			'reject',
			'reparent',
			'resume',
			'rollback',
			'update',
			'updateGoal',
		]),
	),
	agentLocator(showFor(R, ['createFromAgent'])),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Finance Ops',
		displayOptions: showFor(R, ['createFromAgent', 'createStandalone']),
	},
	{
		displayName: 'Additional Fields',
		name: 'employeeFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(R, ['createFromAgent', 'createStandalone']),
		options: configFields(false),
	},
	{
		displayName: 'Update Fields',
		name: 'employeeFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(R, ['update']),
		options: configFields(true),
	},
	extraBodyField(showFor(R, ['createFromAgent', 'createStandalone', 'update'])),

	// getMany
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(R, ['getMany']),
		options: [
			{
				displayName: 'Agent ID',
				name: 'agent_id',
				type: 'number',
				default: 0,
				description: 'Only employees linked to this agent',
			},
		],
	},
	...returnAllAndLimit(R, ['getActivity', 'getMany', 'getRollbackOptions']),

	// previewSchedule
	{
		displayName: 'Heartbeat Cron',
		name: 'heartbeatCron',
		type: 'string',
		default: '',
		placeholder: '0 9 * * 1-5',
		displayOptions: showFor(R, ['previewSchedule']),
	},
	{
		displayName: 'Options',
		name: 'scheduleOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(R, ['previewSchedule']),
		options: [
			{
				displayName: 'Heartbeat Schedule (JSON)',
				name: 'heartbeat_schedule_json',
				type: 'json',
				default: '{}',
			},
			{
				displayName: 'Timezone',
				name: 'execution_timezone',
				type: 'string',
				default: '',
				placeholder: 'America/Sao_Paulo',
			},
		],
	},

	// invoke
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait for the run to finish and return its output. Otherwise returns the started run at once.',
		displayOptions: showFor(R, ['invoke']),
	},
	{
		displayName: 'Options',
		name: 'invokeOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(R, ['invoke'], { waitForCompletion: [true] }),
		options: [
			{
				displayName: 'Poll Interval (Seconds)',
				name: 'pollInterval',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 5,
				description: 'Initial interval to check the run status. It grows up to 15 s.',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 900,
				description: 'Maximum time to wait for the run. 0 = no limit.',
			},
		],
	},

	// pause
	{
		displayName: 'Reason',
		name: 'reason',
		type: 'string',
		default: '',
		displayOptions: showFor(R, ['pause']),
	},

	// rollback
	{
		displayName: 'Version',
		name: 'version',
		type: 'number',
		typeOptions: { minValue: 1 },
		required: true,
		default: 1,
		description: 'Version to restore (see "Get Rollback Options")',
		displayOptions: showFor(R, ['rollback']),
	},

	// reparent
	{
		displayName: 'Parent Employee ID',
		name: 'parentEmployeeId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: showFor(R, ['reparent']),
	},

	// updateGoal
	{
		displayName: 'Goal Title',
		name: 'goalTitle',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(R, ['updateGoal']),
	},
	{
		displayName: 'Goal Fields',
		name: 'goalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(R, ['updateGoal']),
		options: [
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Achieved', value: 'achieved' },
					{ name: 'Active', value: 'active' },
					{ name: 'Cancelled', value: 'cancelled' },
					{ name: 'Planned', value: 'planned' },
				],
				default: 'active',
			},
			{
				displayName: 'Success Criteria',
				name: 'success_criteria',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
			},
		],
	},

	// uploadAvatar
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the image',
		displayOptions: showFor(R, ['uploadAvatar']),
	},
	{
		displayName: 'Avatar Name',
		name: 'avatarName',
		type: 'string',
		default: '',
		displayOptions: showFor(R, ['uploadAvatar']),
	},
];

// ---------------------------------------------------------------------------
// Digital Employee Run
// ---------------------------------------------------------------------------

export const digitalEmployeeRunOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RUN] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get a run', action: 'Get a run' },
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List the runs of a digital employee',
				action: 'Get many runs',
			},
			{
				name: 'Get Output',
				value: 'getOutput',
				description: 'Get the consolidated output of a finished run',
				action: 'Get the output of a run',
			},
			{
				name: 'Get Summary',
				value: 'getSummary',
				description: 'Get aggregated statistics of the runs of a digital employee',
				action: 'Get the run summary',
			},
			{
				name: 'Retry',
				value: 'retry',
				description: 'Run a finished run again',
				action: 'Retry a run',
			},
			{
				name: 'Watch (Stream)',
				value: 'stream',
				description: 'Follow a run live until it ends and return its output',
				action: 'Watch a run',
			},
		],
		default: 'getMany',
	},
];

export const digitalEmployeeRunFields: INodeProperties[] = [
	employeeLocator(showFor(RUN, ['get', 'getMany', 'getOutput', 'getSummary', 'retry', 'stream'])),
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(RUN, ['get', 'getOutput', 'retry', 'stream']),
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 900,
		description: 'Maximum time to follow the run. 0 = no limit.',
		displayOptions: showFor(RUN, ['stream']),
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(RUN, ['getMany']),
		options: [
			{
				displayName: 'Status',
				name: 'status',
				type: 'string',
				default: '',
				placeholder: 'completed',
				description: 'Only runs with this status',
			},
		],
	},
	...returnAllAndLimit(RUN, ['getMany']),
];

// ---------------------------------------------------------------------------
// Digital Employee Template
// ---------------------------------------------------------------------------

export const digitalEmployeeTemplateOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [TPL] } },
		options: [
			{
				name: 'Export',
				value: 'export',
				description: 'Export the digital employee of an agent as a portable template pack',
				action: 'Export a template pack',
			},
			{
				name: 'Import',
				value: 'import',
				description: 'Create or update a digital employee from a template pack',
				action: 'Import a template pack',
			},
			{
				name: 'Preview Import',
				value: 'previewImport',
				description: 'Validate a template pack and show what would be imported',
				action: 'Preview a template pack import',
			},
		],
		default: 'export',
	},
];

export const digitalEmployeeTemplateFields: INodeProperties[] = [
	agentLocator(showFor(TPL, ['export'])),
	agentLocator(showFor(TPL, ['previewImport']), {
		displayName: 'Target Agent',
		description: 'Agent that receives the pack',
	}),
	{
		displayName: 'Template Pack (JSON)',
		name: 'pack',
		type: 'json',
		required: true,
		default: '{}',
		description: 'Pack returned by "Export"',
		displayOptions: showFor(TPL, ['import', 'previewImport']),
	},
	{
		displayName: 'Options',
		name: 'templateOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(TPL, ['import', 'previewImport']),
		options: [
			{
				displayName: 'Collision Strategy',
				name: 'collision_strategy',
				type: 'options',
				options: [
					{ name: 'Overwrite', value: 'overwrite' },
					{ name: 'Rename', value: 'rename' },
					{ name: 'Skip', value: 'skip' },
				],
				default: 'skip',
				description: 'What to do when something with the same name already exists',
			},
			{
				displayName: 'Target Agent ID',
				name: 'target_agent_id',
				type: 'number',
				default: 0,
				description: 'Import only: agent that receives the pack (empty creates a new one)',
			},
		],
	},
];

import type { INodeProperties } from 'n8n-workflow';

import { returnAllAndLimit, showFor } from './common';

const R = 'account';

export const accountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		options: [
			{
				name: 'Get Audit Events',
				value: 'getAuditEvents',
				description: 'List audit events of the workspace in a time window (max 30 days)',
				action: 'Get audit events',
			},
			{
				name: 'Get Current User',
				value: 'getMe',
				description: 'Get name, email, remaining credits and affiliate code of the token owner',
				action: 'Get the current user',
			},
			{
				name: 'Get Mission Control Usage',
				value: 'getMissionControlUsage',
				description: 'Get consumption, execution and adoption metrics for a period',
				action: 'Get mission control usage',
			},
			{
				name: 'Get Workspace Usage',
				value: 'getWorkspaceUsage',
				description: 'List the credit usage entries of the workspace',
				action: 'Get workspace usage',
			},
		],
		default: 'getMe',
	},
];

const USAGE_TYPES = [
	'all',
	'audio',
	'audio_transcription',
	'background_llm',
	'chat',
	'code',
	'connector_calls',
	'external_api',
	'file_upload',
	'image',
	'kb_indexing',
	'magic_prompt',
	'memory_indexing',
	'memory_indexing_legacy',
	'text',
	'tool_execution',
	'video',
	'voiceover',
];

const label = (value: string) =>
	value
		.split('_')
		.map((w) => (w === 'kb' ? 'KB' : w === 'llm' ? 'LLM' : w.charAt(0).toUpperCase() + w.slice(1)))
		.join(' ');

const METRICS = [
	'active_agents',
	'active_autonomous_agents',
	'active_business_days',
	'active_days',
	'active_people',
	'avg_credits_per_execution',
	'avg_credits_per_person',
	'consumption_charged',
	'consumption_net',
	'consumption_refunded',
	'executions',
	'failed_executions',
	'interrupted_executions',
	'success_rate',
	'uses',
];

const GROUP_BY = [
	'activity_category',
	'agent',
	'agent_origin',
	'charge_type',
	'execution_origin',
	'execution_type',
	'modality',
	'person',
	'resource',
	'resource_kind',
	'trigger_source',
];

export const accountFields: INodeProperties[] = [
	// ---------------- período (mission control / audit events) ----------------
	{
		displayName: 'From',
		name: 'from',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'Start of the period (inclusive)',
		displayOptions: showFor(R, ['getAuditEvents', 'getMissionControlUsage']),
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'dateTime',
		required: true,
		default: '',
		description:
			'End of the period (inclusive). Audit events: at most 30 days after "From". Mission Control: at most 93 days.',
		displayOptions: showFor(R, ['getAuditEvents', 'getMissionControlUsage']),
	},

	// ---------------- workspace usage ----------------
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(R, ['getWorkspaceUsage']),
		options: [
			{
				displayName: 'End Date',
				name: 'end_date',
				type: 'dateTime',
				default: '',
				description: 'Custom end date. Use with "Start Date"; overrides "Range".',
			},
			{
				displayName: 'Range',
				name: 'range',
				type: 'options',
				options: [
					{ name: 'Last 24 Hours', value: '1d' },
					{ name: 'Last 30 Days', value: '30d' },
					{ name: 'Last 7 Days', value: '7d' },
				],
				default: '7d',
			},
			{
				displayName: 'Start Date',
				name: 'start_date',
				type: 'dateTime',
				default: '',
				description: 'Custom start date. Use with "End Date"; overrides "Range".',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: USAGE_TYPES.map((value) => ({ name: label(value), value })),
				default: 'all',
			},
			{
				displayName: 'User ID',
				name: 'user_id',
				type: 'number',
				default: 0,
				description: 'Only usage of this user (needs the workspace documents read permission)',
			},
		],
	},

	// ---------------- audit events ----------------
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(R, ['getAuditEvents']),
		options: [
			{ displayName: 'Actor ID', name: 'actor_id', type: 'number', default: 0 },
			{ displayName: 'Entity ID', name: 'entity_id', type: 'string', default: '' },
			{
				displayName: 'Entity Type',
				name: 'entity_type',
				type: 'string',
				default: '',
				placeholder: 'agent_execution',
			},
			{
				displayName: 'Event Type',
				name: 'event_type',
				type: 'string',
				default: '',
				placeholder: 'agent_execution_completed',
			},
			{
				displayName: 'Risk Level',
				name: 'risk_level',
				type: 'options',
				options: [
					{ name: 'Critical', value: 'critical' },
					{ name: 'High', value: 'high' },
					{ name: 'Low', value: 'low' },
					{ name: 'Medium', value: 'medium' },
				],
				default: 'high',
			},
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				options: [
					{ name: 'Activity', value: 'activity' },
					{ name: 'Auditable', value: 'auditable' },
				],
				default: 'auditable',
			},
		],
	},
	...returnAllAndLimit(R, ['getAuditEvents', 'getWorkspaceUsage']),

	// ---------------- mission control ----------------
	{
		displayName: 'Options',
		name: 'missionOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(R, ['getMissionControlUsage']),
		options: [
			{
				displayName: 'Compare With',
				name: 'compare',
				type: 'options',
				options: [
					{ name: 'Previous Calendar Month', value: 'previous_calendar_month' },
					{ name: 'Previous Period', value: 'previous_period' },
				],
				default: 'previous_period',
			},
			{
				displayName: 'Cursor',
				name: 'cursor',
				type: 'string',
				default: '',
				description: '"page.next_cursor" of a previous answer, to get the next page of groups',
			},
			{
				displayName: 'Filters (JSON)',
				name: 'filters',
				type: 'json',
				default: '{}',
				description:
					'Filters as a JSON object, e.g. {"agent": [123], "modality": ["chat"], "trigger_source": ["api"], "status": ["failed"]}',
			},
			{
				displayName: 'Granularity',
				name: 'granularity',
				type: 'options',
				options: [
					{ name: 'Day', value: 'day' },
					{ name: 'Hour', value: 'hour' },
					{ name: 'Month', value: 'month' },
					{ name: 'Week', value: 'week' },
				],
				default: 'day',
			},
			{
				displayName: 'Group By',
				name: 'group_by',
				type: 'multiOptions',
				options: GROUP_BY.map((value) => ({ name: label(value), value })),
				default: [],
				description: 'Up to 3 dimensions',
			},
			{
				displayName: 'Include Group Series',
				name: 'include_group_series',
				type: 'boolean',
				default: false,
				description: 'Whether to also return the time series of every group',
			},
			{
				displayName: 'Limit (Groups)',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 200 },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Metrics',
				name: 'metrics',
				type: 'multiOptions',
				options: METRICS.map((value) => ({ name: label(value), value })),
				default: [],
				description: 'Empty returns net, charged and refunded consumption',
			},
			{
				displayName: 'Order',
				name: 'order',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
				],
				default: 'desc',
			},
			{
				displayName: 'Sort By Metric',
				name: 'sort',
				type: 'string',
				default: '',
				placeholder: 'consumption_net',
			},
			{
				displayName: 'Sort Mode',
				name: 'sort_by',
				type: 'options',
				options: [
					{ name: 'Absolute Change', value: 'delta_abs' },
					{ name: 'Percent Change', value: 'delta_pct' },
					{ name: 'Value', value: 'value' },
				],
				default: 'value',
				description: 'Changes need "Compare With"',
			},
			{
				displayName: 'Timezone',
				name: 'timezone',
				type: 'string',
				default: '',
				placeholder: 'America/Sao_Paulo',
			},
		],
	},
];

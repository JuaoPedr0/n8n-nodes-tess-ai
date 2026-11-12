import type { INodeProperties } from 'n8n-workflow';

import { agentLocator, returnAllAndLimit, showFor } from './common';

const R = 'agentScheduler';

export const agentSchedulerOperations: INodeProperties[] = [
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
				description: 'Schedule an agent to run a prompt once or on a cron',
				action: 'Create a scheduler',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a scheduler',
				action: 'Delete a scheduler',
			},
			{
				name: 'Delete by Conversation',
				value: 'deleteByRootExecution',
				description: 'Delete all schedulers of an agent tied to a conversation (root execution)',
				action: 'Delete the schedulers of a conversation',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a scheduler, including its next run',
				action: 'Get a scheduler',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List schedulers of all agents or of one agent',
				action: 'Get many schedulers',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a scheduler',
				action: 'Update a scheduler',
			},
		],
		default: 'getMany',
	},
];

const schedulerFields: INodeProperties[] = [
	{
		displayName: 'Cron Expression',
		name: 'cron_expression',
		type: 'string',
		default: '',
		placeholder: '0 9 * * 1-5',
		description: 'Recurring schedule (cron). Leave empty and use "Run Once At" for a single run.',
	},
	{
		displayName: 'Email Notification',
		name: 'email_notification_enabled',
		type: 'boolean',
		default: false,
		description: 'Whether to send an email when the scheduled run finishes',
	},
	{
		displayName: 'Enabled',
		name: 'enabled',
		type: 'boolean',
		default: true,
		description: 'Whether the scheduler is active',
	},
	{
		displayName: 'Run Once At',
		name: 'run_once_at',
		type: 'dateTime',
		default: '',
		description: 'Date and time of a single run (instead of a cron expression)',
	},
	{
		displayName: 'Start New Conversation',
		name: 'start_new_conversation',
		type: 'boolean',
		default: false,
		description: 'Whether each run starts a new conversation instead of continuing the same one',
	},
	{
		displayName: 'Timezone',
		name: 'execution_timezone',
		type: 'string',
		default: '',
		placeholder: 'America/Sao_Paulo',
		description: 'IANA timezone used by the cron expression and "Run Once At"',
	},
];

export const agentSchedulerFields: INodeProperties[] = [
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
	agentLocator(showFor(R, ['create', 'delete', 'deleteByRootExecution', 'get', 'update'])),
	{
		displayName: 'Scheduler ID',
		name: 'schedulerId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(R, ['delete', 'get', 'update']),
	},
	{
		displayName: 'Conversation Root ID',
		name: 'rootExecutionId',
		type: 'number',
		required: true,
		default: 0,
		description: 'The "root_id" of the agent conversation (execution) the schedulers belong to',
		displayOptions: showFor(R, ['create', 'deleteByRootExecution']),
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Relatório diário',
		displayOptions: showFor(R, ['create']),
	},
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Message sent to the agent on each run',
		displayOptions: showFor(R, ['create']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(R, ['create']),
		options: schedulerFields,
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(R, ['update']),
		options: [
			{
				displayName: 'Conversation Root ID',
				name: 'agent_root_id_execution',
				type: 'number',
				default: 0,
			},
			...schedulerFields.slice(0, 3),
			{
				displayName: 'Forced Stop Reason',
				name: 'forced_stop_reason',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
			},
			...schedulerFields.slice(3),
		],
	},
	...returnAllAndLimit(R, ['getMany']),
];

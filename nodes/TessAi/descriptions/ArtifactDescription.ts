import type { INodeProperties } from 'n8n-workflow';

import { artifactLocator, returnAllAndLimit, showFor } from './common';

const R = 'artifact';

export const artifactOperations: INodeProperties[] = [
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
				description: 'Create an HTML artifact (public page) from a template',
				action: 'Create an artifact',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete an artifact and stop sharing it',
				action: 'Delete an artifact',
			},
			{
				name: 'Delete Version',
				value: 'deleteVersion',
				description: 'Delete one version of an artifact',
				action: 'Delete an artifact version',
			},
			{
				name: 'Edit',
				value: 'edit',
				description: 'Apply patch operations to the latest version, writing a new version',
				action: 'Edit an artifact',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get the latest version of an artifact with its HTML',
				action: 'Get an artifact',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List the artifacts you created in the workspace',
				action: 'Get many artifacts',
			},
			{
				name: 'Get Templates',
				value: 'getTemplates',
				description: 'List the templates new artifacts can be created from',
				action: 'Get the artifact templates',
			},
			{
				name: 'Get Versions',
				value: 'getVersions',
				description: 'List the version history of an artifact',
				action: 'Get the versions of an artifact',
			},
			{
				name: 'Publish Version',
				value: 'publish',
				description: 'Make a version (default: the latest) the shared one',
				action: 'Publish an artifact version',
			},
			{
				name: 'Rename',
				value: 'rename',
				description: 'Change the title of an artifact',
				action: 'Rename an artifact',
			},
			{
				name: 'Restore Version',
				value: 'restoreVersion',
				description: 'Write an earlier version again as the latest',
				action: 'Restore an artifact version',
			},
			{
				name: 'Share or Unshare',
				value: 'share',
				description: 'Grant or revoke access to people, teams, the workspace or the public link',
				action: 'Share or unshare an artifact',
			},
			{
				name: 'Unpublish',
				value: 'unpublish',
				description: 'Stop sharing the artifact and remove every access grant',
				action: 'Unpublish an artifact',
			},
		],
		default: 'getMany',
	},
];

export const artifactFields: INodeProperties[] = [
	artifactLocator(
		showFor(R, [
			'delete',
			'deleteVersion',
			'edit',
			'get',
			'getVersions',
			'publish',
			'rename',
			'restoreVersion',
			'share',
			'unpublish',
		]),
	),
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(R, ['create', 'rename']),
	},
	{
		displayName: 'Content (HTML)',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 8 },
		required: true,
		default: '',
		description: 'HTML of the content region of the page',
		displayOptions: showFor(R, ['create']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(R, ['create']),
		options: [
			{
				displayName: 'Language',
				name: 'lang',
				type: 'string',
				default: '',
				placeholder: 'pt-BR',
			},
			{
				displayName: 'Script (JS)',
				name: 'script',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
			},
			{
				displayName: 'Styles (CSS)',
				name: 'styles',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
			},
			{
				displayName: 'Template Name or ID',
				name: 'template',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getArtifactTemplates' },
				default: '',
				description:
					'Template the page is rendered with (default: "default"). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
	{
		displayName: 'Operations (JSON)',
		name: 'operations',
		type: 'json',
		required: true,
		default: '[\n  { "op": "replace", "old": "Old text", "new": "New text" }\n]',
		description:
			'Patch operations (1 to 40): replace (old, new), insert_before/insert_after (anchor, text), replace_range (from, to, new), prepend/append (text), set_text (selector, text), replace_element (selector, html), set_attribute (selector, name, value), remove_element (selector). Anchors and selectors must match exactly once.',
		displayOptions: showFor(R, ['edit']),
	},
	{
		displayName: 'Base Version',
		name: 'baseVersion',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description:
			'Version you are editing. If the artifact has a newer version, Tess refuses the edit (409 ARTIFACT_STALE). 0 = do not check.',
		displayOptions: showFor(R, ['edit']),
	},
	{
		displayName: 'Version',
		name: 'version',
		type: 'number',
		typeOptions: { minValue: 1 },
		required: true,
		default: 1,
		displayOptions: showFor(R, ['deleteVersion', 'restoreVersion']),
	},
	{
		displayName: 'Version',
		name: 'version',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description: 'Version to share. 0 = the latest.',
		displayOptions: showFor(R, ['publish']),
	},
	{
		displayName: 'Access Changes',
		name: 'access',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Access Change',
		default: {},
		description:
			'All changes are applied together (all or nothing). The first grant publishes the latest version when nothing is shared yet.',
		displayOptions: showFor(R, ['share']),
		options: [
			{
				displayName: 'Change',
				name: 'changes',
				values: [
					{
						displayName: 'Action',
						name: 'action',
						type: 'options',
						options: [
							{
								name: 'Grant',
								value: 'grant',
							},
							{
								name: 'Revoke',
								value: 'revoke',
							},
						],
						default: 'grant',
					},
					{
						displayName: 'Target',
						name: 'type',
						type: 'options',
						options: [
							{
								name: 'Public (Anyone With the Link)',
								value: 'public',
							},
							{
								name: 'Team',
								value: 'team',
							},
							{
								name: 'User',
								value: 'user',
							},
							{
								name: 'Workspace',
								value: 'workspace',
							},
					],
						default: 'workspace',
					},
					{
						displayName: 'Team ID',
						name: 'team_id',
						type: 'number',
						default: 0
					},
					{
						displayName: 'User Email',
						name: 'email',
						type: 'string',
						placeholder: 'name@email.com',
						default: '',
						description: 'For a user target:	the email, or use \'User ID\'',
					},
					{
						displayName: 'User ID',
						name: 'user_id',
						type: 'number',
						default: 0
					},
			],
			},
		],
	},
	...returnAllAndLimit(R, ['getMany']),
];

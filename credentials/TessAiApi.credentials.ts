import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class TessAiApi implements ICredentialType {
	name = 'tessAiApi';

	displayName = 'Tess AI API';

	icon: Icon = {
		light: 'file:../icons/tess-ai-logo.svg',
		dark: 'file:../icons/tess-ai-logo.dark.svg',
	};

	documentationUrl = 'https://docs.tess.im/en/api-overview';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'API token created in Tess → Settings → API Tokens',
		},
		{
			displayName: 'Workspace ID',
			name: 'workspaceId',
			type: 'string',
			required: true,
			default: '',
			placeholder: '12345',
			description:
				'Numeric workspace ID (Tess → Settings → Workspace, or the w= parameter in the app URL). Required on every API call.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.tess.im',
			description: 'Change only if you use a non-default API endpoint',
		},
		{
			displayName: 'Requests per Second',
			name: 'requestsPerSecond',
			type: 'number',
			typeOptions: { minValue: 0.1, numberPrecision: 2 },
			default: 1,
			description:
				'Maximum calls per second for this token, shared by every workflow that uses this credential (Tess default limit: 1)',
		},
		{
			displayName: 'Rate Limit Coordination',
			name: 'rateLimitMode',
			type: 'options',
			options: [
				{
					name: 'Auto',
					value: 'auto',
					description:
						'Queue mode: share the limit across all workers using the n8n Redis (QUEUE_BULL_REDIS_*). Otherwise: per n8n process.',
				},
				{
					name: 'In-Memory (This n8n Process)',
					value: 'memory',
					description: 'Limit per n8n process only (each worker has its own limit)',
				},
				{
					name: 'Redis (Custom)',
					value: 'redis',
					description: 'Share the limit through a Redis server you specify',
				},
			],
			default: 'auto',
		},
		{
			displayName: 'Redis Host',
			name: 'redisHost',
			type: 'string',
			default: 'localhost',
			displayOptions: { show: { rateLimitMode: ['redis'] } },
		},
		{
			displayName: 'Redis Port',
			name: 'redisPort',
			type: 'number',
			default: 6379,
			displayOptions: { show: { rateLimitMode: ['redis'] } },
		},
		{
			displayName: 'Redis Username',
			name: 'redisUsername',
			type: 'string',
			default: '',
			displayOptions: { show: { rateLimitMode: ['redis'] } },
		},
		{
			displayName: 'Redis Password',
			name: 'redisPassword',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: { show: { rateLimitMode: ['redis'] } },
		},
		{
			displayName: 'Redis Database',
			name: 'redisDatabase',
			type: 'number',
			default: 0,
			displayOptions: { show: { rateLimitMode: ['redis'] } },
		},
		{
			displayName: 'Redis TLS',
			name: 'redisTls',
			type: 'boolean',
			default: false,
			displayOptions: { show: { rateLimitMode: ['redis'] } },
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				'x-workspace-id': '={{$credentials.workspaceId}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/agents',
			qs: { per_page: 1 },
		},
	};
}

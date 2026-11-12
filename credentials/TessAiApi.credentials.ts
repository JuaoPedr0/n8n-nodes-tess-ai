import type { IAuthenticateGeneric, ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

// O teste da credencial fica no node (testedBy: 'tessAiApiTest' em TessAi.node.ts) porque precisa
// validar o Redis da fila alem da API da Tess — um "test" HTTP aqui teria precedencia e so testaria a Tess.

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
				'Maximum calls per second for this token, shared by all workflows and workers through the Redis below (Tess default limit: 1)',
		},
		{
			displayName:
				'Every Tess AI call waits its turn in a queue kept in this Redis, so all workflows and workers using this API Key respect the Tess rate limit together. In production use the same Redis as n8n (queue mode).',
			name: 'redisNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Redis Host',
			name: 'redisHost',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'redis.mycompany.local',
			description: 'Host of the Redis that holds the rate limit queue (Redis 5 or newer)',
		},
		{
			displayName: 'Redis Port',
			name: 'redisPort',
			type: 'number',
			required: true,
			typeOptions: { minValue: 1, maxValue: 65535 },
			default: 6379,
		},
		{
			displayName: 'Redis User',
			name: 'redisUsername',
			type: 'string',
			default: '',
			description: 'Only for Redis ACL users; leave empty to authenticate with the password only',
		},
		{
			displayName: 'Redis Password',
			name: 'redisPassword',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
		{
			displayName: 'Redis Database',
			name: 'redisDatabase',
			type: 'number',
			typeOptions: { minValue: 0 },
			default: 0,
		},
		{
			displayName: 'Redis TLS',
			name: 'redisTls',
			type: 'boolean',
			default: false,
			description: 'Whether to connect to Redis over TLS',
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
}

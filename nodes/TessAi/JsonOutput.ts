// Saida em JSON validada por JSON Schema (https://json-schema.org), como o "Structured Output Parser" do n8n.
// A API da Tess nao tem "JSON mode" (aceita so temperature, messages, tools e model), entao o node:
//   1. envia o schema ao agente como instrucao (mensagens anteriores a mensagem atual);
//   2. extrai o JSON da resposta e valida contra o schema;
//   3. corrige localmente o que e trivial (tipos: "true" → true, "8" → 8, 8 → "8");
//   4. o resto (campo a mais, faltando, enum, tamanho...) volta para o agente corrigir.
// Validador proprio (sem dependencias de runtime): cobre type, properties, required, additionalProperties,
// items (lista e tupla), enum, const, anyOf/oneOf/allOf, $ref local ($defs/definitions), nullable,
// min/max (Length, Items, imum), exclusiveMin/Max, multipleOf, pattern e format (date, date-time, email, uri, uuid).

export interface JsonCheck {
	ok: boolean;
	value?: unknown;
	error?: string;
}

export interface JsonSchema {
	type?: string | string[];
	properties?: Record<string, JsonSchema | boolean>;
	required?: string[];
	additionalProperties?: boolean | JsonSchema;
	items?: JsonSchema | boolean | Array<JsonSchema | boolean>;
	enum?: unknown[];
	const?: unknown;
	anyOf?: Array<JsonSchema | boolean>;
	oneOf?: Array<JsonSchema | boolean>;
	allOf?: Array<JsonSchema | boolean>;
	$ref?: string;
	$defs?: Record<string, JsonSchema>;
	definitions?: Record<string, JsonSchema>;
	nullable?: boolean;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	format?: string;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	multipleOf?: number;
	minItems?: number;
	maxItems?: number;
	description?: string;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Extracao do JSON da resposta
// ---------------------------------------------------------------------------

/** Extrai JSON de uma resposta de modelo: aceita ```json ... ```, texto antes/depois e objeto ou array. */
export function extractJson(output: unknown): JsonCheck {
	if (output !== null && typeof output === 'object') return { ok: true, value: output };

	const raw = String(output ?? '').trim();
	if (!raw) return { ok: false, error: 'the answer was empty' };

	const candidates: string[] = [];
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced) candidates.push(fenced[1].trim());
	candidates.push(raw);

	let lastError = '';
	for (const text of candidates) {
		try {
			return { ok: true, value: JSON.parse(text) };
		} catch (error) {
			lastError = (error as Error).message;
		}
		const start = text.search(/[[{]/);
		if (start === -1) continue;
		const close = text[start] === '{' ? '}' : ']';
		const end = text.lastIndexOf(close);
		if (end <= start) continue;
		try {
			return { ok: true, value: JSON.parse(text.slice(start, end + 1)) };
		} catch (error) {
			lastError = (error as Error).message;
		}
	}
	return { ok: false, error: `the answer is not valid JSON (${lastError || 'no JSON found'})` };
}

// ---------------------------------------------------------------------------
// Schema a partir do parametro do node
// ---------------------------------------------------------------------------

function parseJsonParam(raw: unknown, label: string): unknown {
	if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
		throw new Error(`${label} is required when Output Format is JSON`);
	}
	if (typeof raw !== 'string') return raw;
	let parseError = '';
	try {
		return JSON.parse(raw);
	} catch (error) {
		parseError = (error as Error).message;
	}
	throw new Error(`${label} is not valid JSON (${parseError})`);
}

const TYPE_NAMES: Record<string, string> = {
	string: 'string',
	text: 'string',
	number: 'number',
	float: 'number',
	integer: 'integer',
	int: 'integer',
	boolean: 'boolean',
	bool: 'boolean',
};

/**
 * Gera um JSON Schema a partir de um exemplo (modo "Generate From JSON Example"):
 * todas as chaves obrigatorias, nada alem delas, tipos pelos valores do exemplo, array pelo 1o item.
 * Strings "string", "number", "integer", "boolean" valem como nome do tipo. null = qualquer tipo.
 */
export function schemaFromExample(example: unknown): JsonSchema {
	if (example === null) return {};
	if (Array.isArray(example)) {
		return example.length
			? { type: 'array', items: schemaFromExample(example[0]) }
			: { type: 'array' };
	}
	if (typeof example === 'object') {
		const entries = Object.entries(example as Record<string, unknown>);
		return {
			type: 'object',
			properties: Object.fromEntries(entries.map(([k, v]) => [k, schemaFromExample(v)])),
			required: entries.map(([k]) => k),
			additionalProperties: false,
		};
	}
	if (typeof example === 'boolean') return { type: 'boolean' };
	if (typeof example === 'number') return { type: 'number' };
	const named = TYPE_NAMES[String(example).trim().toLowerCase()];
	if (named) return { type: named };
	if (String(example).trim().toLowerCase() === 'any') return {};
	return { type: 'string' };
}

export function buildSchema(
	schemaType: string,
	example: unknown,
	inputSchema: unknown,
): { schema: JsonSchema; example?: unknown } {
	if (schemaType === 'manual') {
		const schema = parseJsonParam(inputSchema, 'Input Schema');
		if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
			throw new Error(
				'Input Schema must be a JSON Schema object, e.g. { "type": "object", "properties": { ... } }',
			);
		}
		return { schema: schema as JsonSchema };
	}
	const parsed = parseJsonParam(example, 'JSON Example');
	if (parsed === null || typeof parsed !== 'object') {
		throw new Error('JSON Example must be a JSON object or array');
	}
	return { schema: schemaFromExample(parsed), example: parsed };
}

// ---------------------------------------------------------------------------
// Validacao
// ---------------------------------------------------------------------------

export interface ValidationResult {
	value: unknown;
	errors: string[];
	fixes: string[];
}

interface Ctx {
	root: JsonSchema;
	errors: string[];
	fixes: string[];
	/** additionalProperties nao declarado: false = campo extra e erro (padrao) */
	allowExtraByDefault: boolean;
}

const FORMATS: Record<string, (v: string) => boolean> = {
	date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
	'date-time': (v) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)),
	time: (v) => /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/.test(v),
	email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
	uri: (v) => /^[a-z][a-z0-9+.-]*:\S+$/i.test(v),
	url: (v) => /^[a-z][a-z0-9+.-]*:\S+$/i.test(v),
	uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
};

function typeOfValue(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
	return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
	const actual = typeOfValue(value);
	if (type === 'number') return actual === 'number' || actual === 'integer';
	return actual === type;
}

/** Converte o que e trivial para o tipo pedido. Devolve undefined se nao der. */
function coerce(value: unknown, type: string): { ok: boolean; value?: unknown } {
	if (typeof value === 'string') {
		const v = value.trim();
		if (type === 'boolean' && /^(true|false)$/i.test(v))
			return { ok: true, value: v.toLowerCase() === 'true' };
		if ((type === 'number' || type === 'integer') && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) {
			const n = Number(v);
			if (type === 'integer' && !Number.isInteger(n)) return { ok: false };
			return { ok: true, value: n };
		}
		if (type === 'null' && /^null$/i.test(v)) return { ok: true, value: null };
	}
	if (type === 'string' && (typeof value === 'number' || typeof value === 'boolean')) {
		return { ok: true, value: String(value) };
	}
	if (type === 'integer' && typeof value === 'number' && Number.isInteger(value))
		return { ok: true, value };
	return { ok: false };
}

function resolveRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
	let current = schema;
	for (let depth = 0; current.$ref && depth < 20; depth++) {
		const ref = current.$ref;
		if (!ref.startsWith('#')) throw new Error(`only local $ref are supported (${ref})`);
		let target: unknown = root;
		for (const part of ref.replace(/^#\/?/, '').split('/').filter(Boolean)) {
			const key = decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'));
			target = (target as Record<string, unknown> | undefined)?.[key];
		}
		if (!target || typeof target !== 'object') throw new Error(`$ref not found: ${ref}`);
		const rest: JsonSchema = { ...current };
		delete rest.$ref;
		current = { ...(target as JsonSchema), ...rest };
	}
	return current;
}

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function describeAllowed(values: unknown[]): string {
	return values.map((v) => JSON.stringify(v)).join(', ');
}

function validateNode(
	value: unknown,
	schemaIn: JsonSchema | boolean,
	path: string,
	ctx: Ctx,
): unknown {
	if (schemaIn === true || schemaIn === undefined) return value;
	if (schemaIn === false) {
		ctx.errors.push(`${path} is not allowed`);
		return value;
	}
	const schema = resolveRef(schemaIn, ctx.root);

	// allOf: todas
	if (schema.allOf) {
		for (const sub of schema.allOf) value = validateNode(value, sub, path, ctx);
	}

	// anyOf / oneOf: a primeira alternativa que validar sem erros
	const alternatives = schema.anyOf ?? schema.oneOf;
	if (alternatives) {
		let best: { value: unknown; errors: string[]; fixes: string[] } | undefined;
		for (const alt of alternatives) {
			const sub: Ctx = { ...ctx, errors: [], fixes: [] };
			const v = validateNode(value, alt, path, sub);
			if (!sub.errors.length) {
				ctx.fixes.push(...sub.fixes);
				value = v;
				best = undefined;
				break;
			}
			if (!best || sub.errors.length < best.errors.length)
				best = { value: v, errors: sub.errors, fixes: sub.fixes };
		}
		if (best) {
			ctx.errors.push(`${path} does not match any allowed alternative (${best.errors[0]})`);
			return value;
		}
	}

	// type (com coercao do que e trivial)
	let types =
		schema.type === undefined ? [] : Array.isArray(schema.type) ? [...schema.type] : [schema.type];
	if (!types.length) {
		if (schema.properties || schema.additionalProperties !== undefined || schema.required)
			types = ['object'];
		else if (schema.items) types = ['array'];
	}
	if (schema.nullable && types.length) types.push('null');

	// "null" em texto onde null e permitido → null (antes de aceitar como string)
	if (types.includes('null') && typeof value === 'string' && /^null$/i.test(value.trim())) {
		ctx.fixes.push(`${path}: "${value}" → null`);
		return null;
	}

	if (types.length && !types.some((t) => matchesType(value, t))) {
		let fixed = false;
		for (const t of types) {
			const c = coerce(value, t);
			if (c.ok) {
				ctx.fixes.push(`${path}: ${JSON.stringify(value)} → ${t}`);
				value = c.value;
				fixed = true;
				break;
			}
		}
		if (!fixed) {
			ctx.errors.push(`${path} must be ${types.join(' or ')} (got ${typeOfValue(value)})`);
			return value;
		}
	}

	// const / enum (tenta coercao para o tipo do valor permitido)
	const allowed = schema.const !== undefined ? [schema.const] : schema.enum;
	if (allowed) {
		if (!allowed.some((a) => sameValue(a, value))) {
			const match = allowed.find((a) => {
				const c = coerce(value, typeOfValue(a) === 'integer' ? 'number' : typeOfValue(a));
				return c.ok && sameValue(a, c.value);
			});
			if (match !== undefined) {
				ctx.fixes.push(`${path}: ${JSON.stringify(value)} → ${JSON.stringify(match)}`);
				value = match;
			} else {
				ctx.errors.push(
					`${path} must be one of: ${describeAllowed(allowed)} (got ${JSON.stringify(value)})`,
				);
				return value;
			}
		}
	}

	if (value === null) return value;

	// objeto
	if (typeof value === 'object' && !Array.isArray(value)) {
		const input = value as Record<string, unknown>;
		const props = schema.properties ?? {};
		const out: Record<string, unknown> = {};
		for (const key of schema.required ?? []) {
			if (!(key in input)) ctx.errors.push(`${path}.${key} is missing (required)`);
		}
		for (const [key, v] of Object.entries(input)) {
			if (key in props) {
				out[key] = validateNode(v, props[key], `${path}.${key}`, ctx);
				continue;
			}
			const extra = schema.additionalProperties;
			if (extra === undefined ? !ctx.allowExtraByDefault : extra === false) {
				ctx.errors.push(`${path}.${key} was not requested (remove it)`);
			} else {
				out[key] = typeof extra === 'object' ? validateNode(v, extra, `${path}.${key}`, ctx) : v;
			}
		}
		return out;
	}

	// array
	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			ctx.errors.push(
				`${path} must have at least ${schema.minItems} item(s) (got ${value.length})`,
			);
		}
		if (schema.maxItems !== undefined && value.length > schema.maxItems) {
			ctx.errors.push(`${path} must have at most ${schema.maxItems} item(s) (got ${value.length})`);
		}
		const items = schema.items;
		if (items === undefined) return value;
		return value.map((item, idx) => {
			const itemSchema = Array.isArray(items) ? (items[idx] ?? true) : items;
			return validateNode(item, itemSchema, `${path}[${idx}]`, ctx);
		});
	}

	// string
	if (typeof value === 'string') {
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			ctx.errors.push(`${path} must have at least ${schema.minLength} character(s)`);
		}
		if (schema.maxLength !== undefined && value.length > schema.maxLength) {
			ctx.errors.push(`${path} must have at most ${schema.maxLength} character(s)`);
		}
		if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
			ctx.errors.push(`${path} must match the pattern ${schema.pattern}`);
		}
		const check = schema.format ? FORMATS[schema.format] : undefined;
		if (check && !check(value)) ctx.errors.push(`${path} must be a valid ${schema.format}`);
		return value;
	}

	// numero
	if (typeof value === 'number') {
		if (schema.minimum !== undefined && value < schema.minimum)
			ctx.errors.push(`${path} must be >= ${schema.minimum}`);
		if (schema.maximum !== undefined && value > schema.maximum)
			ctx.errors.push(`${path} must be <= ${schema.maximum}`);
		if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
			ctx.errors.push(`${path} must be > ${schema.exclusiveMinimum}`);
		}
		if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
			ctx.errors.push(`${path} must be < ${schema.exclusiveMaximum}`);
		}
		if (
			schema.multipleOf &&
			Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9
		) {
			ctx.errors.push(`${path} must be a multiple of ${schema.multipleOf}`);
		}
	}
	return value;
}

/**
 * Valida (e converte o que for trivial) um valor contra o JSON Schema.
 * Campos nao declarados sao erro, a menos que o schema diga "additionalProperties": true.
 */
export function validateSchema(value: unknown, schema: JsonSchema): ValidationResult {
	const ctx: Ctx = { root: schema, errors: [], fixes: [], allowExtraByDefault: false };
	const out = validateNode(value, schema, '$', ctx);
	return { value: out, errors: ctx.errors, fixes: ctx.fixes };
}

// ---------------------------------------------------------------------------
// Mensagens para o agente
// ---------------------------------------------------------------------------

function pretty(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

/** Instrucao enviada como mensagens anteriores (usuario + confirmacao do assistente). */
export function instructionMessages(
	schema: JsonSchema,
	example?: unknown,
): Array<{ role: string; content: string }> {
	const lines = [
		'Response format rules for this conversation:',
		'- Answer ONLY with a JSON value that validates against the JSON Schema below: no markdown, no code fences, no comments, no text before or after.',
		'- Use exactly the properties defined in the schema: do NOT add properties that are not in the schema and do not omit required ones.',
		'- Respect the types: true/false for booleans, numbers without quotes, strings in quotes, arrays and objects as defined.',
		'',
		'JSON Schema:',
		pretty(schema),
	];
	if (example !== undefined)
		lines.push('', 'Example of a valid answer (same structure):', pretty(example));
	return [
		{ role: 'user', content: lines.join('\n') },
		{
			role: 'assistant',
			content:
				'Understood. I will answer only with valid JSON that follows exactly that JSON Schema.',
		},
	];
}

export function correctionMessage(problems: string[], schema: JsonSchema): string {
	return [
		'Your previous answer does not validate against the required JSON Schema:',
		...problems.slice(0, 30).map((p) => `- ${p}`),
		'',
		'Reply again with ONLY the corrected JSON (no extra properties), valid against this JSON Schema:',
		pretty(schema),
	].join('\n');
}

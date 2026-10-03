// Saida em JSON: a API da Tess nao tem "JSON mode" (aceita so temperature, messages, tools e model),
// entao o node envia um DTO (estrutura esperada) como instrucao, extrai o JSON da resposta, valida
// contra o DTO e corrige localmente o que e trivial (tipos). O resto volta para o agente corrigir.

export interface JsonCheck {
	ok: boolean;
	value?: unknown;
	error?: string;
}

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
		// primeiro { ou [ ate o ultimo } ou ] correspondente
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
// DTO
// ---------------------------------------------------------------------------

type DtoType = 'string' | 'number' | 'boolean' | 'any';

const TYPE_NAMES: Record<string, DtoType> = {
	string: 'string',
	text: 'string',
	number: 'number',
	integer: 'number',
	float: 'number',
	boolean: 'boolean',
	bool: 'boolean',
	any: 'any',
};

/**
 * Tipo esperado de um valor do DTO. Aceita exemplo ("abc", 10, true) ou nome do tipo
 * ("string", "number", "boolean", "any").
 */
function scalarTypeOf(example: unknown): DtoType {
	if (example === null) return 'any';
	if (typeof example === 'boolean') return 'boolean';
	if (typeof example === 'number') return 'number';
	if (typeof example === 'string') return TYPE_NAMES[example.trim().toLowerCase()] ?? 'string';
	return 'any';
}

export function parseDto(raw: unknown): unknown {
	if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
		throw new Error('the Response DTO is required when Output Format is JSON');
	}
	const dto = typeof raw === 'string' ? JSON.parse(raw) : raw;
	if (dto === null || typeof dto !== 'object') {
		throw new Error('the Response DTO must be a JSON object or array');
	}
	if (!Array.isArray(dto) && Object.keys(dto).length === 0) {
		throw new Error('the Response DTO must have at least one field');
	}
	return dto;
}

export interface DtoResult {
	value: unknown;
	errors: string[];
	fixes: string[];
}

/**
 * Valida (e converte o que for trivial) um valor contra o DTO.
 * - campo a mais ou faltando → erro (o agente corrige)
 * - "true"/"false" → boolean, "12.5" → número, número/boolean → texto → corrigido aqui (fixes)
 * - null e aceito em qualquer campo
 */
export function validateDto(value: unknown, dto: unknown, path = '$'): DtoResult {
	const errors: string[] = [];
	const fixes: string[] = [];

	if (value === null) return { value, errors, fixes };

	// objeto
	if (dto !== null && typeof dto === 'object' && !Array.isArray(dto)) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return { value, errors: [`${path} must be an object`], fixes };
		}
		const shape = dto as Record<string, unknown>;
		const input = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(shape)) {
			if (!(key in input)) {
				errors.push(`${path}.${key} is missing`);
				continue;
			}
			const child = validateDto(input[key], shape[key], `${path}.${key}`);
			out[key] = child.value;
			errors.push(...child.errors);
			fixes.push(...child.fixes);
		}
		for (const key of Object.keys(input)) {
			if (!(key in shape)) errors.push(`${path}.${key} was not requested (remove it)`);
		}
		return { value: out, errors, fixes };
	}

	// array: o primeiro item do DTO define o formato de todos os itens
	if (Array.isArray(dto)) {
		if (!Array.isArray(value)) return { value, errors: [`${path} must be an array`], fixes };
		if (dto.length === 0) return { value, errors, fixes };
		const out = value.map((item, idx) => {
			const child = validateDto(item, dto[0], `${path}[${idx}]`);
			errors.push(...child.errors);
			fixes.push(...child.fixes);
			return child.value;
		});
		return { value: out, errors, fixes };
	}

	// escalar
	const type = scalarTypeOf(dto);
	if (type === 'any') return { value, errors, fixes };

	if (type === 'boolean') {
		if (typeof value === 'boolean') return { value, errors, fixes };
		if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) {
			fixes.push(`${path}: "${value}" → boolean`);
			return { value: value.trim().toLowerCase() === 'true', errors, fixes };
		}
		return { value, errors: [`${path} must be a boolean (true/false)`], fixes };
	}

	if (type === 'number') {
		if (typeof value === 'number' && Number.isFinite(value)) return { value, errors, fixes };
		if (typeof value === 'string' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim())) {
			fixes.push(`${path}: "${value}" → number`);
			return { value: Number(value.trim()), errors, fixes };
		}
		return { value, errors: [`${path} must be a number`], fixes };
	}

	// string
	if (typeof value === 'string') return { value, errors, fixes };
	if (typeof value === 'number' || typeof value === 'boolean') {
		fixes.push(`${path}: ${value} → string`);
		return { value: String(value), errors, fixes };
	}
	return { value, errors: [`${path} must be a string`], fixes };
}

// ---------------------------------------------------------------------------
// Mensagens para o agente
// ---------------------------------------------------------------------------

function dtoText(dto: unknown): string {
	return JSON.stringify(dto, null, 2);
}

/** Instrucao enviada como mensagens anteriores (usuario + confirmacao do assistente). */
export function instructionMessages(dto: unknown): Array<{ role: string; content: string }> {
	return [
		{
			role: 'user',
			content: [
				'Response format rules for this conversation:',
				'- Answer ONLY with valid JSON (RFC 8259): no markdown, no code fences, no comments, no text before or after.',
				'- Use EXACTLY the structure below: the same keys, no extra keys, no missing keys.',
				'- Respect the types: true/false for booleans, numbers without quotes, text in quotes. Use null when a value is unknown.',
				'- For arrays, every item follows the format of the example item.',
				'',
				'Structure:',
				dtoText(dto),
			].join('\n'),
		},
		{
			role: 'assistant',
			content: 'Understood. I will answer only with valid JSON following exactly that structure.',
		},
	];
}

export function correctionMessage(problems: string[], dto: unknown): string {
	return [
		'Your previous answer does not follow the required JSON structure:',
		...problems.slice(0, 30).map((p) => `- ${p}`),
		'',
		'Reply again with ONLY the corrected JSON, using exactly this structure (no extra keys):',
		dtoText(dto),
	].join('\n');
}

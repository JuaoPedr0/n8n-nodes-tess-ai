// Saida em JSON: a API da Tess nao tem "JSON mode" (aceita so temperature, messages, tools e model),
// entao o node pede JSON no prompt, extrai/valida a resposta e, se precisar, pede a correcao.

export interface JsonCheck {
	ok: boolean;
	value?: unknown;
	error?: string;
}

/** Extrai JSON de uma resposta de modelo: aceita ```json ... ```, texto antes/depois e objeto ou array. */
export function extractJson(output: unknown): JsonCheck {
	if (output !== null && typeof output === 'object') return { ok: true, value: output };

	const raw = String(output ?? '').trim();
	if (!raw) return { ok: false, error: 'The agent returned an empty output' };

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
	return {
		ok: false,
		error: `The agent output is not valid JSON (${lastError || 'no JSON found'})`,
	};
}

/** Confere se o JSON tem as chaves obrigatorias (no objeto, ou em cada item se for array). */
export function missingKeys(value: unknown, required: string[]): string[] {
	if (!required.length) return [];
	const objects = Array.isArray(value) ? value : [value];
	const missing = new Set<string>();
	for (const obj of objects) {
		if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
			required.forEach((k) => missing.add(k));
			continue;
		}
		for (const key of required) if (!(key in (obj as Record<string, unknown>))) missing.add(key);
	}
	return [...missing];
}

export function jsonInstruction(example: string, requiredKeys: string[]): string {
	const lines = [
		'IMPORTANT: answer ONLY with valid JSON (RFC 8259).',
		'No markdown, no code fences, no comments and no text before or after the JSON.',
	];
	if (example.trim()) lines.push(`Follow exactly this structure:\n${example.trim()}`);
	if (requiredKeys.length)
		lines.push(`The JSON must contain the keys: ${requiredKeys.join(', ')}.`);
	return lines.join('\n');
}

export function correctionMessage(
	problem: string,
	example: string,
	requiredKeys: string[],
): string {
	return `Your previous answer could not be used: ${problem}.\n${jsonInstruction(example, requiredKeys)}\nReply again with only the corrected JSON.`;
}

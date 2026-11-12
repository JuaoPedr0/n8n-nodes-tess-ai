import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
	resolve: {
		// o build CommonJS do n8n-workflow e o que o n8n carrega de verdade (o node compila para commonjs);
		// vindo direto do Node, o vite tambem nao gera centenas de avisos "Sourcemap ... missing source files"
		alias: [{ find: /^n8n-workflow$/, replacement: require.resolve('n8n-workflow') }],
	},
	test: {
		include: ['test/**/*.test.ts'],
		server: { deps: { external: [/node_modules[\/]n8n-workflow/] } },
	},
});

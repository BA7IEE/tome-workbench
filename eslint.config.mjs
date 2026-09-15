import tseslint from 'typescript-eslint';
export default [
 { ignores:['dist/**','node_modules/**','reports/**'] },
 ...tseslint.configs.recommended,
 {files:['**/*.cjs','**/*.mjs'],rules:{'@typescript-eslint/no-require-imports':'off','@typescript-eslint/no-unused-vars':'off'}},
 {files:['src/**/*.ts','web/src/**/*.{ts,tsx}'],rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}]}}
];

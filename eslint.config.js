import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'src/rules/*.ts'] },
  ...tseslint.configs.recommended,
);

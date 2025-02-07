import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                allowDefaultProject: {
                    allow: ['*.js', '*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
                project: './tsconfig.json',
            },
        },
    },
    {
        ignores: [
            'dist/*',
            'example/*',
            'test/*',
            'eslint.config.mjs',
            'prettier.config.mjs',
            'tasks.js',
            'src/lib/socket.io.js',
        ],
    },
    {
        // disable temporary the rule 'jsdoc/require-param' and enable 'jsdoc/require-jsdoc'
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
        },
    },
];

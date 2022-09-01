module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    env: {
        browser: true,
        amd: true,
        node: true
    },
    parserOptions: {
        project: [
            './tsconfig.eslint.json'
        ],
        sourceType: 'module'
    },
    plugins: [
        '@typescript-eslint',
        'unicorn',
    ],
    'extends': [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    rules: {
        '@typescript-eslint/adjacent-overload-signatures': 'error',
        '@typescript-eslint/array-type': [
            'error',
            {
                'default': 'array'
            }
        ],
        '@typescript-eslint/dot-notation': 'error',
        '@typescript-eslint/explicit-member-accessibility': [
            'error',
            {
                accessibility: 'explicit',
                overrides: {
                    constructors: 'off'
                }
            }
        ],
        '@typescript-eslint/indent': [ 'error', 4 ],
        '@typescript-eslint/member-delimiter-style': [
            'error',
            {
                multiline: {
                    delimiter: 'semi',
                    requireLast: true
                },
                singleline: {
                    delimiter: 'semi',
                    requireLast: false
                }
            }
        ],
        '@typescript-eslint/member-ordering': 'error',
        '@typescript-eslint/naming-convention': ['error', {
            selector: 'variable',
            format: ['PascalCase', 'UPPER_CASE', 'camelCase'],
            leadingUnderscore: 'allow'
        }],
        '@typescript-eslint/no-empty-interface': 'error',
        /**
         * Temporarily disable `@typescript-eslint/no-explicit-any` to reduce the noisy amount of warnings
         *
         * Where possible, please avoid the use of the `any` type
         */
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-extraneous-class': 'error',
        '@typescript-eslint/no-floating-promises': ['error', { ignoreIIFE: true }],
        '@typescript-eslint/no-for-in-array': 'error',
        '@typescript-eslint/no-inferrable-types': 'error',
        '@typescript-eslint/no-misused-new': 'error',
        '@typescript-eslint/no-namespace': 1,
        '@typescript-eslint/no-unused-expressions': 'error',
        '@typescript-eslint/no-unused-vars': 1,
        '@typescript-eslint/prefer-for-of': 'error',
        '@typescript-eslint/prefer-function-type': 'error',
        '@typescript-eslint/prefer-namespace-keyword': 'off',
        '@typescript-eslint/keyword-spacing': ['error', { before: true }],
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/semi': [
            'error',
            'always'
        ],
        '@typescript-eslint/triple-slash-reference': 'error',
        '@typescript-eslint/unbound-method': 'error',
        'arrow-body-style': 'error',
        'constructor-super': 'error',
        curly: 'error',
        'default-case': 'error',
        eqeqeq: [
            'error',
            'always'
        ],
        'id-blacklist': [
            'error',
            'any',
            'Number',
            'number',
            'String',
            'string',
            'Boolean',
            'boolean',
            'Undefined',
            'undefined'
        ],
        'id-match': 'error',
        'import/no-extraneous-dependencies': 'off',
        'import/no-internal-modules': 'off',
        'import/order': 'off',
        'max-classes-per-file': [
            'off',
            1
        ],
        'max-len': [
            'error',
            {
                code: 120
            }
        ],
        'new-parens': 'error',
        'no-caller': 'error',
        'no-case-declarations': 'warn',
        'no-console': 'off',
        'no-duplicate-case': 'error',
        'no-empty': [
            'error',
            {
                allowEmptyCatch: true
            }
        ],
        'no-eval': 'error',
        'no-extra-bind': 'error',
        'no-fallthrough': 'error',
        'no-multiple-empty-lines': 'error',
        'no-new-func': 'error',
        'no-new-wrappers': 'error',
        'no-redeclare': 'error',
        'no-return-await': 'error',
        'no-sequences': 'error',
        'no-shadow': 1,
        'no-sparse-arrays': 'error',
        'no-template-curly-in-string': 'error',
        'no-throw-literal': 'error',
        'no-trailing-spaces': 'error',
        'no-underscore-dangle': 'error',
        'no-unsafe-finally': 'error',
        'no-useless-escape': 'error',
        'no-useless-constructor': 'error',
        'no-var': 'error',
        'object-curly-spacing': ['error', 'always'],
        'one-var': [
            'error',
            'never'
        ],
        'padding-line-between-statements': [
            'error',
            {
                blankLine: 'always',
                prev: '*',
                next: 'return'
            }
        ],
        'prefer-const': 'error',
        'prefer-object-spread': 'off',
        'prefer-template': 'error',
        quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
        'quote-props': ['error', 'as-needed', { keywords: true }],
        'template-curly-spacing': ['error', 'never'],
        'unicorn/filename-case': [
            'error',
            {
                cases: {
                    kebabCase: true,
                    pascalCase: true
                }
            }
        ],
        'use-isnan': 'error',
        yoda: 'error',
        '@typescript-eslint/no-var-requires': 1,
        '@typescript-eslint/ban-types': 1,
        '@typescript-eslint/ban-ts-comment': 1,
        '@typescript-eslint/no-dynamic-delete': 0,
        '@typescript-eslint/no-inferred-empty-object-type': 0,
        '@typescript-eslint/no-null-undefined-union': 0,
        '@typescript-eslint/no-tautology-expression': 0,
        '@typescript-eslint/number-literal-format': 0,
        // '@typescript-eslint/prefer-method-signature': 0,
        '@typescript-eslint/static-this': 0,
    }
};
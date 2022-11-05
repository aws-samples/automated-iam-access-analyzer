module.exports = {
    env: {
        browser: true,
        es2021: true
    },
    extends: [
        "airbnb-base",
        "eslint-config-prettier",
        "plugin:jest/recommended",
        "plugin:import/typescript"
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 12,
        sourceType: "module",
        tsconfigRootDir: __dirname,
        project: ["./tsconfig.json"]
    },
    plugins: [
        "@typescript-eslint",
        "eslint-plugin-prettier"
    ],
    rules: {
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": "error",
        "prettier/prettier": "error",
        "no-new": "off",
        "import/extensions": [
            "error",
            "ignorePackages",
            {
                js: "never",
                jsx: "never",
                ts: "never",
                tsx: "never"
            }
        ]
    }
};

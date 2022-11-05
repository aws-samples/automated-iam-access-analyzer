module.exports = {
    extends: ['@commitlint/config-angular', '@commitlint/config-conventional'],
    rules: {
        'footer-max-line-length': [2, 'always', 260],
        'scope-case': [2, 'always', ['lower-case', 'upper-case']],
        'body-max-line-length': [2, 'always', 260],
    }
};

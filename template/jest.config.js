module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Run with `CI=true npm test` locally — rate limiters skip only when CI=true.
  // feedback_rate_limiter_dev_skip.
};

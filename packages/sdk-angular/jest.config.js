/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  moduleNameMapper: {
    // Map to source files so ts-jest can transform them
    "^@rollgate/sdk-browser$": "<rootDir>/../sdk-browser/src/index.ts",
    "^@rollgate/sdk-core$": "<rootDir>/../sdk-core/src/index.ts",
  },
};

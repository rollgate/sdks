/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
  moduleNameMapper: {
    // Map to source files so ts-jest can transform them
    "^@rollgate/sdk-browser$": "<rootDir>/../sdk-browser/src/index.ts",
    "^@rollgate/sdk-core$": "<rootDir>/../sdk-core/src/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
        },
      },
    ],
  },
};

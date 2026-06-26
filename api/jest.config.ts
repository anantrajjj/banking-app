import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.spec.ts',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Relax some strict checks for test files
          noUnusedLocals: false,
          noUnusedParameters: false,
          strict: true,
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/app.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
};

export default config;

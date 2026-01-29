# Contributing to Rollgate SDKs

Thank you for your interest in contributing to Rollgate SDKs!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/sdks.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature`

## Development

### Building

```bash
# Build all SDKs
npm run build

# Build specific SDK
npm run build --workspace=@rollgate/sdk-node
```

### Testing

```bash
# Run all tests
npm test

# Run tests for specific SDK
npm test --workspace=@rollgate/sdk-node
```

### Code Style

We use Prettier for formatting:

```bash
npm run format
```

## Pull Requests

1. Ensure all tests pass
2. Update documentation if needed
3. Add a clear description of your changes
4. Reference any related issues

## Reporting Issues

Please use GitHub Issues to report bugs or request features. Include:

- SDK name and version
- Node.js/runtime version
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

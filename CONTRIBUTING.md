# Contributing to Referendum Citoyen

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 20+
- Expo CLI
- iOS: Xcode 15+, CocoaPods
- Android: Android Studio, NDK 26.1.10909125

### Getting Started

```bash
# Clone the repository
git clone https://github.com/ReferendumCitoyen/referendum-citoyen-react-native.git
cd referendum-citoyen-react-native

# Install dependencies
npm install

# Generate native projects
npx expo prebuild

# Start development
npx expo run:ios
# or
npx expo run:android
```

## Code Style

### Formatting

We use Prettier for code formatting. Run before committing:

```bash
npm run format
```

### Linting

We use ESLint for code quality. Check for issues with:

```bash
npm run lint
```

### TypeScript

- Use strict TypeScript - avoid `any` types when possible
- Define interfaces for component props
- Use proper type imports

## Git Workflow

### Branch Naming

- `feature/` - New features (e.g., `feature/add-biometric-auth`)
- `fix/` - Bug fixes (e.g., `fix/nfc-timeout-error`)
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or fixes

### Commit Messages

Follow conventional commit format:

```
type(scope): description

[optional body]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat(voting): add confirmation step`
- `fix(nfc): handle timeout on slow devices`
- `docs(readme): update installation instructions`

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `npm run lint` and `npm run format`
5. Test on both iOS and Android if possible
6. Submit a PR with a clear description

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Project Structure

```
app/                    # Expo Router screens
components/             # Reusable React components
contexts/               # React context providers
hooks/                  # Custom React hooks
utils/                  # Utility functions
constants/              # Theme and content constants
modules/                # Native modules
locales/                # i18n translations
```

## Need Help?

- Check existing [issues](https://github.com/ReferendumCitoyen/referendum-citoyen-react-native/issues)
- Read the [Integration Guide](./INTEGRATION_GUIDE.md) for native module setup
- Open a new issue for bugs or feature requests

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

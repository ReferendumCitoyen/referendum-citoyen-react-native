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

### Branching model

We use a two-branch GitFlow-lite:

- **`develop`** — integration branch. All feature work, bug fixes, refactors,
  and docs go here. The nightly Android build (debug-signed APK) runs off
  this branch.
- **`master`** — release branch. Updated only by maintainers, who merge
  `develop` into `master` when a cut is ready. Signed-release APKs are
  built from tags on `master`.

```
   feature/foo ──┐
                 ├──► develop ──(maintainer merge)──► master ──(tag v1.4)──► signed APK
   fix/bar ─────┘                  │                              │
                                   ▼                              ▼
                          nightly debug APK             GitHub Release w/ SHA-256
```

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

1. Fork the repository (or branch directly if you have write access)
2. Create a feature branch off **`develop`**: `git checkout develop && git pull && git checkout -b feature/<short-name>`
3. Make your changes
4. Run `npm run lint`, `npm run format`, `npm test`, and `npx tsc --noEmit`
5. Test on both iOS and Android if possible
6. Open a PR **against `develop`**, not `master`. PRs targeting `master`
   will be redirected — only maintainers merge into `master`.

### Cutting a release (maintainers only)

Releases are gated to `master` so the signed-APK workflow can't be tricked
into shipping unreviewed code from a feature branch. The workflow
verifies that the tag's commit is an ancestor of `origin/master` and
refuses to run otherwise.

1. Merge `develop` into `master`:
   ```
   git checkout master && git pull
   git merge --no-ff develop
   git push origin master
   ```
2. Tag the release commit on `master`:
   ```
   git tag -a v1.4 -m "Référendum Citoyen v1.4"
   git push origin v1.4
   ```
   Tag names must match `v[0-9]*` (e.g. `v1.4`, `v1.4.1`, `v2.0-beta1`).
3. The `Android Release (signed APK)` workflow runs automatically. When it
   finishes, the signed APK + SHA-256 + `apksigner verify` output are
   attached to a GitHub Release named after the tag.
4. Bump `app.config.ts` `version` on `develop` to the next planned version
   so subsequent nightlies don't collide with the just-released tag.

The one-time signing-keystore setup (`keytool` recipe + required GitHub
secrets) is documented in the header of
`.github/workflows/android-release.yml`.

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

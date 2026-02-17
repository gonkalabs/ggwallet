# Contributing to GG Wallet

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- Node.js 18+
- npm

## Setup

```bash
git clone https://github.com/gonkalabs/ggwallet.git
cd ggwallet
npm install
```

## Development

```bash
npm run dev       # Vite dev server with HMR
npm run build     # Type-check + production build
```

Load the extension from `dist/` in `chrome://extensions/` with Developer mode enabled.

## Code Quality

Before submitting a PR, make sure your changes pass all checks:

```bash
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # Vitest
```

To auto-fix lint and formatting issues:

```bash
npm run lint:fix
npm run format
```

## Submitting Changes

1. Fork the repo and create a feature branch from `main`.
2. Make your changes with clear, descriptive commits.
3. Add or update tests if you're changing logic in `src/lib/` or `src/background/`.
4. Run `npm run lint`, `npm run format:check`, and `npm test` to verify.
5. Open a pull request against `main` with a description of what you changed and why.

## Reporting Bugs

Open a GitHub issue with:

- Steps to reproduce
- Expected vs. actual behavior
- Browser and OS version
- Extension version (from `manifest.json`)

## Security Vulnerabilities

**Do not open a public issue.** See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.

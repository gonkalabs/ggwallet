# Security Policy

GG Wallet handles private keys and mnemonics. We take security seriously.

## Reporting a Vulnerability

If you discover a security vulnerability, **do not open a public GitHub issue**.

Instead, please email **security@gonkalabs.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and work with you to understand and address the issue before any public disclosure.

## Scope

The following are in scope:

- Mnemonic encryption/decryption (`src/lib/crypto.ts`)
- Key derivation and storage (`src/background/keystore.ts`)
- Private key export (`exportPrivateKeyHex`)
- Message passing between content scripts and the service worker
- dApp provider injection and approval flow

## Responsible Disclosure

We ask that you:

- Give us reasonable time to fix the issue before disclosing publicly
- Do not exploit the vulnerability beyond what's needed to demonstrate it
- Do not access other users' data

We are grateful for security researchers who help keep GG Wallet safe.

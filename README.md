# GG Wallet

> **Chrome Web Store:** Currently under review. The store link will be published here once approved. In the meantime, you can install from the [latest release](https://github.com/gonkalabs/ggwallet/releases) or build from source.

A browser extension wallet built exclusively for the **Gonka blockchain** network.

## Features

- **Send & Receive** GNK tokens
- **Import CLI wallets** — import your `inferenced` CLI wallet by entering the mnemonic phrase it gave you during setup
- **Transaction History** via gonka.gg Explorer API
- **Staking** — delegate, undelegate, and claim rewards (feature disabled for now)
- **QR Code** for receiving tokens
- **Secure Storage** — mnemonic encrypted with AES-GCM (PBKDF2 key derivation)
- **Auto-lock** after 5 minutes of inactivity
- **Private Key Export** — compatible with [opengnk](https://github.com/gonkalabs/opengnk) proxy
- **Gonka Inference Signer** — TypeScript port of the opengnk signing scheme (RFC 6979 ECDSA)

## Tech Stack

- React 18 + TypeScript
- Vite + CRXJS (Chrome Extension MV3)
- Tailwind CSS
- CosmJS (Stargate)
- @noble/hashes + @noble/secp256k1

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install & Build

```bash
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `dist/` folder

### Development

```bash
npm run dev
```

This starts Vite in watch mode with HMR for the popup UI.

## Gonka Chain Configuration

| Property | Value |
|---|---|
| Chain ID | `gonka-mainnet` |
| RPC | `http://node1.gonka.ai:8000/chain-rpc/` |
| REST | `http://node1.gonka.ai:8000/chain-api/` |
| Denom | `ngonka` (base), `GNK` (display) |
| Decimals | 9 (1 GNK = 1,000,000,000 ngonka) |
| Bech32 Prefix | `gonka` |
| Coin Type (BIP44) | 1200 |
| HD Path | `m/44'/1200'/0'/0/0` |

## Project Structure

```
src/
  background/          # Service worker (keystore, message handlers)
  popup/               # React UI
    pages/             # Welcome, CreateWallet, Dashboard, Send, etc.
    components/        # Shared UI components
    store.ts           # Zustand state management
  lib/
    gonka.ts           # Chain configuration constants
    gonka-signer.ts    # opengnk-compatible inference request signer
    cosmos.ts          # CosmJS helpers (balance, send, stake)
    api.ts             # gonka.gg Explorer API client
    crypto.ts          # AES-GCM encryption helpers
    format.ts          # Amount formatting utilities
    messaging.ts       # Chrome extension message passing
    storage.ts         # chrome.storage.local helpers
```

## Planned Features

- **IBC token support** — display IBC tokens alongside native GNK
- **Full-precision transaction amounts** — show exact amounts without rounding, even with many decimal places
- **Staking** - re-enable delegation, undelegation, and reward claiming
- **Governance** — view proposals, vote, and create new proposals

## API Key

The wallet uses the [gonka.gg](https://gonka.gg) Explorer API to fetch **transaction history** for the active wallet. The API key is located in [`src/lib/gonka.ts`](src/lib/gonka.ts) (`GONKA_EXPLORER_API_KEY`). If you're self-hosting or forking, replace it with your own key from gonka.gg.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines and how to submit changes.

## Security

If you discover a security vulnerability, please follow the process described in [SECURITY.md](SECURITY.md). **Do not open a public issue for security bugs.**

## License

MIT with Attribution — see [LICENSE](LICENSE) for details. Forks and derivative works must include visible attribution to GG Wallet by gonkalabs.com.

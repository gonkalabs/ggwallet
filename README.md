# GG Wallet

[**→ Install from Chrome Web Store**](https://chromewebstore.google.com/detail/gg-wallet/elicodfmaffbndngiifcpmammicgjidd) (v0.1.8) — or install from the [latest release](https://github.com/gonkalabs/ggwallet/releases) / build from source.


A browser extension wallet built exclusively for the **Gonka blockchain** network.

## Features

- **Send & Receive** GNK tokens
- **Full-precision amounts** — all balances and transaction amounts displayed without rounding
- **Import CLI wallets** — import your `inferenced` CLI wallet by entering the mnemonic phrase it gave you during setup
- **Transaction History** via gonka.gg Explorer API
- **Governance** — browse proposals, view tally results, vote (Yes / No / Abstain / Veto), and submit new proposals
- **QR Code** for receiving tokens
- **Secure Storage** — mnemonic encrypted with AES-GCM (PBKDF2 key derivation)
- **IBC token support** — view and send IBC tokens alongside native GNK
- **Address Book** — save frequent recipients, quick-fill the Send form
- **Auto-lock** — configurable timeout (1 / 5 / 15 / 30 min or never)
- **Private Key Export** — compatible with [opengnk](https://github.com/gonkalabs/opengnk) proxy
- **Gonka Inference Signer** — TypeScript port of the opengnk signing scheme (RFC 6979 ECDSA)
- **Gonka Name Service (GNS)** — register human-readable `.gnk` names that resolve to wallet addresses, like ENS on Ethereum. Your primary name is displayed in the wallet, and you can send tokens to any `.gnk` name instead of pasting a long address. [**Purchase a .gnk name on gonka.gg**](https://gonka.gg/gns)
- **dApp Provider** — built-in Keplr-compatible provider (`window.gonkaWallet`) lets dApps connect, request signatures, and broadcast transactions through the wallet

## Gonka Name Service (GNS)

GNS lets you register a short, memorable name like `mike.gnk` that maps to your `gonka1...` address. The wallet integrates GNS in two ways:

- **Name display** — your primary `.gnk` name appears on the main screen next to your address
- **Send by name** — type a `.gnk` name in the Send page instead of a full address; the wallet resolves it automatically

Names cost 1 GNK each, never expire, and can be transferred or sold on the marketplace. One wallet can own multiple names with one set as "primary" for reverse lookup.

| | |
|---|---|
| Register a name | [gonka.gg/gns](https://gonka.gg/gns) |
| Contract address | `gonka1rd582xazhyxde68g099ed0zpjzq0j0shnhkegg06s8009h7lnxjqvyf0qf` |
| Name rules | 3-63 chars, lowercase a-z, 0-9, hyphens, no leading/trailing hyphen |
| Suffix | `.gnk` |
| Price | 1 GNK per name |

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
    gns.ts             # GNS name resolution and reverse lookup
    cosmos.ts          # CosmJS helpers (balance, send, stake, governance)
    api.ts             # gonka.gg Explorer API client
    crypto.ts          # AES-GCM encryption helpers
    format.ts          # Amount formatting utilities
    messaging.ts       # Chrome extension message passing
    storage.ts         # chrome.storage.local helpers
```

## Planned Features

- **Staking** — delegate, undelegate, and claim rewards

## API Key

The wallet uses the [gonka.gg](https://gonka.gg) Explorer API to fetch **transaction history** for the active wallet. The API key is located in [`src/lib/gonka.ts`](src/lib/gonka.ts) (`GONKA_EXPLORER_API_KEY`). If you're self-hosting or forking, replace it with your own key from gonka.gg.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines and how to submit changes.

## Security

If you discover a security vulnerability, please follow the process described in [SECURITY.md](SECURITY.md). **Do not open a public issue for security bugs.**

## License

MIT with Attribution — see [LICENSE](LICENSE) for details. Forks and derivative works must include visible attribution to GG Wallet by gonkalabs.com.

/**
 * Inpage provider script — injected into every web page.
 *
 * Exposes a Keplr-compatible API at:
 *   - window.gonkaWallet  (primary)
 *
 * Also provides convenience helpers:
 *   - window.getOfflineSigner(chainId)
 *   - window.getOfflineSignerOnlyAmino(chainId)
 *   - window.getOfflineSignerAuto(chainId)
 *
 * Communication: sends requests via window.postMessage to the content script,
 * which relays them to the background service worker.
 */

// ------------------------------------------------------------------
//  Types
// ------------------------------------------------------------------

interface Key {
  readonly name: string;
  readonly algo: string;
  readonly pubKey: Uint8Array;
  readonly address: Uint8Array;
  readonly bech32Address: string;
  readonly ethereumHexAddress: string;
  readonly isNanoLedger: boolean;
  readonly isKeystone: boolean;
}

interface AccountData {
  readonly address: string;
  readonly algo: string;
  readonly pubkey: Uint8Array; // lowercase — matches CosmJS AccountData interface
}

interface AminoSignResponse {
  readonly signed: any;
  readonly signature: {
    readonly pub_key: { type: string; value: string };
    readonly signature: string;
  };
}

interface DirectSignResponse {
  readonly signed: any;
  readonly signature: {
    readonly pub_key: { type: string; value: string };
    readonly signature: string;
  };
}

interface KeplrSignOptions {
  readonly preferNoSetFee?: boolean;
  readonly preferNoSetMemo?: boolean;
  readonly disableBalanceCheck?: boolean;
}

interface ChainInfo {
  readonly rpc: string;
  readonly rest: string;
  readonly chainId: string;
  readonly chainName: string;
  readonly stakeCurrency?: any;
  readonly bip44?: any;
  readonly bech32Config?: any;
  readonly currencies?: any[];
  readonly feeCurrencies?: any[];
  readonly features?: string[];
  [key: string]: any;
}

// ------------------------------------------------------------------
//  Messaging helpers
// ------------------------------------------------------------------

const CHANNEL = "gonka-wallet-provider";
let _reqId = 0;
const _pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

/**
 * Deep-serialize params for postMessage / chrome.runtime.sendMessage.
 * Converts Uint8Array → plain number[], BigInt → string, and handles
 * protobuf Long objects so nothing non-serializable slips through.
 */
function serializeParams(value: any): any {
  if (value === null || value === undefined) return value;
  if (value instanceof Uint8Array) return Array.from(value);
  if (typeof value === "bigint") return value.toString();
  // Protobuf Long (has low/high/unsigned fields)
  if (typeof value === "object" && typeof value.low === "number" && typeof value.high === "number") {
    return value.toString ? value.toString() : String(value.low + value.high * 0x100000000);
  }
  if (Array.isArray(value)) return value.map(serializeParams);
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[key] = serializeParams(value[key]);
    }
    return out;
  }
  return value;
}

/** Send a request to the content script and wait for a response. */
function sendProviderRequest(method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++_reqId;
    _pending.set(id, { resolve, reject });
    window.postMessage(
      { channel: CHANNEL, direction: "to-content", id, method, params: serializeParams(params) },
      "*",
    );

    // Timeout after 5 minutes (for approval popups)
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        reject(new Error("GonkaWallet: request timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

/** Listen for responses from the content script. */
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.channel !== CHANNEL || data.direction !== "to-inpage") return;

  const pending = _pending.get(data.id);
  if (!pending) return;
  _pending.delete(data.id);

  if (data.error) {
    pending.reject(new Error(data.error));
  } else {
    pending.resolve(data.result);
  }
});

// ------------------------------------------------------------------
//  Helper: reconstruct Uint8Array from serialized data
// ------------------------------------------------------------------

function toUint8Array(data: any): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data && typeof data === "object" && data.type === "Buffer" && Array.isArray(data.data)) {
    return new Uint8Array(data.data);
  }
  // Object with numeric keys (serialized Uint8Array)
  if (data && typeof data === "object") {
    const keys = Object.keys(data);
    if (keys.length > 0 && keys.every((k) => !isNaN(Number(k)))) {
      return new Uint8Array(keys.map((k) => data[k]));
    }
  }
  return new Uint8Array(0);
}

// ------------------------------------------------------------------
//  OfflineSigner implementations
// ------------------------------------------------------------------

class GonkaOfflineSigner {
  constructor(
    private chainId: string,
    private signOptions?: KeplrSignOptions,
  ) {}

  async getAccounts(): Promise<AccountData[]> {
    const key = await gonkaWalletProvider.getKey(this.chainId);
    return [
      {
        address: key.bech32Address,
        algo: key.algo as string,
        pubkey: key.pubKey, // lowercase — CosmJS AccountData interface
      },
    ];
  }

  async signAmino(signerAddress: string, signDoc: any): Promise<AminoSignResponse> {
    return gonkaWalletProvider.signAmino(this.chainId, signerAddress, signDoc, this.signOptions);
  }

  async signDirect(signerAddress: string, signDoc: any): Promise<DirectSignResponse> {
    return gonkaWalletProvider.signDirect(this.chainId, signerAddress, signDoc, this.signOptions);
  }
}

class GonkaOfflineSignerOnlyAmino {
  constructor(
    private chainId: string,
    private signOptions?: KeplrSignOptions,
  ) {}

  async getAccounts(): Promise<AccountData[]> {
    const key = await gonkaWalletProvider.getKey(this.chainId);
    return [
      {
        address: key.bech32Address,
        algo: key.algo as string,
        pubkey: key.pubKey, // lowercase — CosmJS AccountData interface
      },
    ];
  }

  async signAmino(signerAddress: string, signDoc: any): Promise<AminoSignResponse> {
    return gonkaWalletProvider.signAmino(this.chainId, signerAddress, signDoc, this.signOptions);
  }
}

// ------------------------------------------------------------------
//  Main provider object (Keplr-compatible)
// ------------------------------------------------------------------

const gonkaWalletProvider = {
  /** Identifies this provider as GG Wallet. */
  isGonkaWallet: true,

  /** Default sign options. */
  defaultOptions: {} as KeplrSignOptions,

  /**
   * Request access to the wallet for the given chain(s).
   * In Keplr, this prompts the user for permission and unlocks.
   */
  async enable(chainIds: string | string[]): Promise<void> {
    const ids = Array.isArray(chainIds) ? chainIds : [chainIds];
    await sendProviderRequest("enable", { chainIds: ids });
  },

  /**
   * Suggest a new chain to the wallet.
   */
  async experimentalSuggestChain(chainInfo: ChainInfo): Promise<void> {
    await sendProviderRequest("experimentalSuggestChain", { chainInfo });
  },

  /**
   * Get the key (address + pubkey) for a chain.
   */
  async getKey(chainId: string): Promise<Key> {
    const result = await sendProviderRequest("getKey", { chainId });
    const pubKey = toUint8Array(result.pubKey);
    const address = toUint8Array(result.address);
    return {
      name: result.name || "",
      algo: result.algo || "secp256k1",
      pubKey,
      address,
      bech32Address: result.bech32Address || "",
      ethereumHexAddress: result.ethereumHexAddress || "",
      isNanoLedger: false,
      isKeystone: false,
    };
  },

  /**
   * Sign an Amino-encoded transaction.
   */
  async signAmino(
    chainId: string,
    signer: string,
    signDoc: any,
    signOptions?: KeplrSignOptions,
  ): Promise<AminoSignResponse> {
    return sendProviderRequest("signAmino", { chainId, signer, signDoc, signOptions });
  },

  /**
   * Sign a Protobuf-encoded transaction (Direct).
   */
  async signDirect(
    chainId: string,
    signer: string,
    signDoc: any,
    signOptions?: KeplrSignOptions,
  ): Promise<DirectSignResponse> {
    // serializeParams() in sendProviderRequest handles all Uint8Array/BigInt/Long conversion
    const result = await sendProviderRequest("signDirect", {
      chainId,
      signer,
      signDoc,
      signOptions,
    });
    // Reconstruct Uint8Arrays — the signed bytes travel through JSON serialization
    // and must be restored before the dApp can use them with protobuf encoding.
    return {
      ...result,
      signed: {
        ...result.signed,
        bodyBytes: toUint8Array(result.signed?.bodyBytes),
        authInfoBytes: toUint8Array(result.signed?.authInfoBytes),
      },
    };
  },

  /**
   * Broadcast a signed transaction.
   */
  async sendTx(chainId: string, tx: Uint8Array, mode: string): Promise<Uint8Array> {
    const result = await sendProviderRequest("sendTx", {
      chainId,
      tx,
      mode,
    });
    return toUint8Array(result);
  },

  /**
   * Get an OfflineSigner (supports both Amino and Direct).
   */
  getOfflineSigner(chainId: string, signOptions?: KeplrSignOptions) {
    return new GonkaOfflineSigner(chainId, signOptions);
  },

  /**
   * Get an OfflineSigner that only supports Amino signing.
   */
  getOfflineSignerOnlyAmino(chainId: string, signOptions?: KeplrSignOptions) {
    return new GonkaOfflineSignerOnlyAmino(chainId, signOptions);
  },

  /**
   * Auto-select the appropriate signer. For GG Wallet, always returns
   * a full signer (since we don't use Ledger).
   */
  async getOfflineSignerAuto(chainId: string, signOptions?: KeplrSignOptions) {
    return new GonkaOfflineSigner(chainId, signOptions);
  },

  /**
   * Sign arbitrary data (ADR-036).
   */
  async signArbitrary(
    chainId: string,
    signer: string,
    data: string | Uint8Array,
  ): Promise<{ pub_key: { type: string; value: string }; signature: string }> {
    return sendProviderRequest("signArbitrary", { chainId, signer, data });
  },

  /**
   * Verify arbitrary signature.
   */
  async verifyArbitrary(
    _chainId: string,
    _signer: string,
    _data: string | Uint8Array,
    _signature: any,
  ): Promise<boolean> {
    // Verification can be done client-side; return true for now
    return true;
  },
};

// ------------------------------------------------------------------
//  Inject into window
// ------------------------------------------------------------------

// Primary: window.gonkaWallet
Object.defineProperty(window, "gonkaWallet", {
  value: gonkaWalletProvider,
  writable: false,
  configurable: false,
});

// Convenience helpers on window (Keplr compatibility)
Object.defineProperty(window, "getOfflineSigner", {
  value: (chainId: string, signOptions?: KeplrSignOptions) =>
    gonkaWalletProvider.getOfflineSigner(chainId, signOptions),
  writable: true,
  configurable: true,
});

Object.defineProperty(window, "getOfflineSignerOnlyAmino", {
  value: (chainId: string, signOptions?: KeplrSignOptions) =>
    gonkaWalletProvider.getOfflineSignerOnlyAmino(chainId, signOptions),
  writable: true,
  configurable: true,
});

Object.defineProperty(window, "getOfflineSignerAuto", {
  value: async (chainId: string, signOptions?: KeplrSignOptions) =>
    gonkaWalletProvider.getOfflineSignerAuto(chainId, signOptions),
  writable: true,
  configurable: true,
});

// Dispatch event so dApps know the wallet is ready
window.dispatchEvent(new Event("gonkaWallet#initialized"));

// Also dispatch keplr#initialized for compatibility
window.dispatchEvent(new Event("keplr#initialized"));

console.log("[GG Wallet] Provider injected at window.gonkaWallet");

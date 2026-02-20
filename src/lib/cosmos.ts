import { StargateClient, SigningStargateClient, GasPrice, coin } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Slip10RawIndex, HdPath, Bip39, EnglishMnemonic, Slip10, Slip10Curve, stringToPath } from "@cosmjs/crypto";
import { GONKA_DENOM, GONKA_BECH32_PREFIX, GONKA_COIN_TYPE, GONKA_DECIMALS, GONKA_DISPLAY_DENOM } from "./gonka";
import { getActiveEndpoint } from "./rpc";

export interface TokenBalance {
  denom: string;
  amount: string;
  symbol: string;
  decimals: number;
  isIbc: boolean;
}

/** In-memory cache for resolved IBC denom traces (hash -> {symbol, decimals}). */
const _ibcDenomCache = new Map<string, { symbol: string; decimals: number }>();

let _client: StargateClient | null = null;
let _clientRpc: string | null = null;

/**
 * HD path for Gonka: m/44'/1200'/0'/0/0
 */
const GONKA_HD: HdPath = [
  Slip10RawIndex.hardened(44),
  Slip10RawIndex.hardened(GONKA_COIN_TYPE),
  Slip10RawIndex.hardened(0),
  Slip10RawIndex.normal(0),
  Slip10RawIndex.normal(0),
];

/**
 * Get a read-only Stargate client (singleton, reconnects if needed).
 */
export async function getClient(): Promise<StargateClient> {
  const { rpc } = await getActiveEndpoint();
  if (!_client || _clientRpc !== rpc) {
    if (_client) _client.disconnect();
    _client = await StargateClient.connect(rpc);
    _clientRpc = rpc;
  }
  return _client;
}

/** Force-disconnect the cached client so the next call picks up a new endpoint. */
export function resetClient(): void {
  if (_client) _client.disconnect();
  _client = null;
  _clientRpc = null;
}

/**
 * Get a signing client from a mnemonic.
 */
export async function getSigningClient(mnemonic: string): Promise<{
  client: SigningStargateClient;
  address: string;
}> {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: GONKA_BECH32_PREFIX,
    hdPaths: [GONKA_HD],
  });

  const [account] = await wallet.getAccounts();
  const { rpc } = await getActiveEndpoint();
  const client = await SigningStargateClient.connectWithSigner(rpc, wallet, {
    gasPrice: GasPrice.fromString(`0${GONKA_DENOM}`),
  });

  return { client, address: account.address };
}

/**
 * Derive a Gonka address from a mnemonic (without connecting to RPC).
 */
export async function deriveAddress(mnemonic: string): Promise<string> {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: GONKA_BECH32_PREFIX,
    hdPaths: [GONKA_HD],
  });
  const [account] = await wallet.getAccounts();
  return account.address;
}

/**
 * Derive the raw secp256k1 private key bytes from a mnemonic.
 * Used for exporting and for the Gonka inference signer.
 */
export async function derivePrivateKey(mnemonic: string): Promise<Uint8Array> {
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic));
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, stringToPath("m/44'/1200'/0'/0/0"));
  return privkey;
}

/**
 * Query balance for an address. Returns amount in ngonka.
 */
export async function queryBalance(address: string): Promise<string> {
  const client = await getClient();
  const balance = await client.getBalance(address, GONKA_DENOM);
  return balance.amount;
}

/**
 * Resolve an IBC denom hash to a human-readable symbol and decimals.
 * Uses the active REST endpoint's denom trace API.
 * Results are cached in memory for the lifetime of the service worker.
 */
export async function resolveIbcDenom(
  ibcDenom: string
): Promise<{ symbol: string; decimals: number }> {
  const hash = ibcDenom.replace(/^ibc\//i, "");
  if (_ibcDenomCache.has(hash)) return _ibcDenomCache.get(hash)!;

  const fallback = { symbol: `IBC-${hash.slice(0, 4)}`, decimals: 6 };

  try {
    const { rest } = await getActiveEndpoint();
    const resp = await fetch(
      `${rest}ibc/apps/transfer/v1/denom_traces/${hash}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) {
      _ibcDenomCache.set(hash, fallback);
      return fallback;
    }
    const data = await resp.json();
    const baseDenom: string = data.denom_trace?.base_denom || "";
    // "uatom" -> "ATOM", "usdc" -> "USDC", anything else uppercased as-is
    const symbol = baseDenom.startsWith("u")
      ? baseDenom.slice(1).toUpperCase()
      : baseDenom.toUpperCase() || fallback.symbol;
    const resolved = { symbol, decimals: 6 };
    _ibcDenomCache.set(hash, resolved);
    return resolved;
  } catch {
    _ibcDenomCache.set(hash, fallback);
    return fallback;
  }
}

/**
 * Query all token balances for an address (GNK + IBC tokens).
 * Resolves IBC denom hashes to human-readable symbols via the REST endpoint.
 */
export async function queryAllBalances(address: string): Promise<TokenBalance[]> {
  const client = await getClient();
  const coins = await client.getAllBalances(address);

  const results = await Promise.all(
    coins.map(async (c): Promise<TokenBalance> => {
      if (c.denom === GONKA_DENOM) {
        return {
          denom: c.denom,
          amount: c.amount,
          symbol: GONKA_DISPLAY_DENOM,
          decimals: GONKA_DECIMALS,
          isIbc: false,
        };
      }
      if (c.denom.startsWith("ibc/")) {
        const { symbol, decimals } = await resolveIbcDenom(c.denom);
        return { denom: c.denom, amount: c.amount, symbol, decimals, isIbc: true };
      }
      // Unknown native denom
      return {
        denom: c.denom,
        amount: c.amount,
        symbol: c.denom.toUpperCase(),
        decimals: 0,
        isIbc: false,
      };
    })
  );

  // GNK first, then IBC tokens, then others
  return results.sort((a, b) => {
    if (!a.isIbc && !b.isIbc) return 0;
    if (!a.isIbc) return -1;
    if (!b.isIbc) return 1;
    return a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Send tokens from the wallet. Defaults to native GNK but accepts any denom (IBC included).
 */
export async function sendTokens(
  mnemonic: string,
  recipientAddress: string,
  amount: string,
  denom: string = GONKA_DENOM,
  memo = ""
): Promise<{ txHash: string; height: number }> {
  const { client, address } = await getSigningClient(mnemonic);
  const result = await client.sendTokens(
    address,
    recipientAddress,
    [coin(amount, denom)],
    "auto",
    memo
  );

  if (result.code !== 0) {
    throw new Error(`Transaction failed with code ${result.code}: ${result.rawLog}`);
  }

  return {
    txHash: result.transactionHash,
    height: result.height,
  };
}

/**
 * Delegate tokens to a validator.
 */
export async function delegateTokens(
  mnemonic: string,
  validatorAddress: string,
  amount: string
): Promise<{ txHash: string }> {
  const { client, address } = await getSigningClient(mnemonic);
  const result = await client.delegateTokens(
    address,
    validatorAddress,
    coin(amount, GONKA_DENOM),
    "auto"
  );

  if (result.code !== 0) {
    throw new Error(`Delegation failed: ${result.rawLog}`);
  }

  return { txHash: result.transactionHash };
}

/**
 * Undelegate tokens from a validator.
 */
export async function undelegateTokens(
  mnemonic: string,
  validatorAddress: string,
  amount: string
): Promise<{ txHash: string }> {
  const { client, address } = await getSigningClient(mnemonic);
  const result = await client.undelegateTokens(
    address,
    validatorAddress,
    coin(amount, GONKA_DENOM),
    "auto"
  );

  if (result.code !== 0) {
    throw new Error(`Undelegation failed: ${result.rawLog}`);
  }

  return { txHash: result.transactionHash };
}

// ---- Governance ----

export interface Proposal {
  id: string;
  title: string;
  summary: string;
  description: string;
  proposer: string;
  status: string;
  submitTime: string;
  depositEndTime: string;
  votingStartTime: string;
  votingEndTime: string;
  totalDeposit: string;
  metadata: string;
  finalTallyResult: {
    yes: string;
    abstain: string;
    no: string;
    noWithVeto: string;
  };
}

export type VoteOption = "VOTE_OPTION_YES" | "VOTE_OPTION_NO" | "VOTE_OPTION_ABSTAIN" | "VOTE_OPTION_NO_WITH_VETO";

function parseProposal(p: any): Proposal {
  const msgs = p.messages || [];
  const content = msgs[0]?.content || p.content || {};
  const rawMeta = p.metadata || "";
  const meta = (() => { try { return JSON.parse(rawMeta); } catch { return {}; } })();

  const summary = p.summary || meta.summary || content.description || "";
  const description = meta.details || meta.description || content.description || summary;

  return {
    id: p.id || p.proposal_id || "0",
    title: p.title || meta.title || content.title || `Proposal #${p.id || p.proposal_id}`,
    summary,
    description,
    proposer: p.proposer || "",
    status: p.status || "",
    submitTime: p.submit_time || "",
    depositEndTime: p.deposit_end_time || "",
    votingStartTime: p.voting_start_time || "",
    votingEndTime: p.voting_end_time || "",
    totalDeposit: p.total_deposit?.[0]?.amount || "0",
    metadata: rawMeta,
    finalTallyResult: {
      yes: p.final_tally_result?.yes_count || p.final_tally_result?.yes || "0",
      abstain: p.final_tally_result?.abstain_count || p.final_tally_result?.abstain || "0",
      no: p.final_tally_result?.no_count || p.final_tally_result?.no || "0",
      noWithVeto: p.final_tally_result?.no_with_veto_count || p.final_tally_result?.no_with_veto || "0",
    },
  };
}

export async function queryProposals(): Promise<Proposal[]> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(
    `${rest}cosmos/gov/v1/proposals?pagination.limit=50&pagination.reverse=true`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!resp.ok) throw new Error(`Failed to fetch proposals: ${resp.status}`);
  const data = await resp.json();
  return (data.proposals || []).map(parseProposal);
}

export async function queryProposal(proposalId: string): Promise<Proposal> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(
    `${rest}cosmos/gov/v1/proposals/${proposalId}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!resp.ok) throw new Error(`Failed to fetch proposal: ${resp.status}`);
  const data = await resp.json();
  return parseProposal(data.proposal);
}

export async function queryProposalTally(proposalId: string): Promise<Proposal["finalTallyResult"]> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(
    `${rest}cosmos/gov/v1/proposals/${proposalId}/tally`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!resp.ok) throw new Error(`Failed to fetch tally: ${resp.status}`);
  const data = await resp.json();
  const t = data.tally || {};
  return {
    yes: t.yes_count || t.yes || "0",
    abstain: t.abstain_count || t.abstain || "0",
    no: t.no_count || t.no || "0",
    noWithVeto: t.no_with_veto_count || t.no_with_veto || "0",
  };
}

export async function queryVote(proposalId: string, voter: string): Promise<string | null> {
  const { rest } = await getActiveEndpoint();
  try {
    const resp = await fetch(
      `${rest}cosmos/gov/v1/proposals/${proposalId}/votes/${voter}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.vote?.options?.[0]?.option || null;
  } catch {
    return null;
  }
}

export async function voteProposal(
  mnemonic: string,
  proposalId: string,
  option: VoteOption
): Promise<{ txHash: string }> {
  const { client, address } = await getSigningClient(mnemonic);

  const optionMap: Record<VoteOption, number> = {
    VOTE_OPTION_YES: 1,
    VOTE_OPTION_ABSTAIN: 2,
    VOTE_OPTION_NO: 3,
    VOTE_OPTION_NO_WITH_VETO: 4,
  };

  const msg = {
    typeUrl: "/cosmos.gov.v1beta1.MsgVote",
    value: {
      proposalId: BigInt(proposalId),
      voter: address,
      option: optionMap[option],
    },
  };

  const result = await client.signAndBroadcast(address, [msg], "auto");
  if (result.code !== 0) {
    throw new Error(`Vote failed: ${result.rawLog}`);
  }
  return { txHash: result.transactionHash };
}

export async function submitProposal(
  mnemonic: string,
  title: string,
  description: string,
  initialDeposit: string
): Promise<{ txHash: string; proposalId?: string }> {
  const { client, address } = await getSigningClient(mnemonic);

  const msg = {
    typeUrl: "/cosmos.gov.v1beta1.MsgSubmitProposal",
    value: {
      content: {
        typeUrl: "/cosmos.gov.v1beta1.TextProposal",
        value: {
          title,
          description,
        },
      },
      initialDeposit: initialDeposit !== "0" ? [coin(initialDeposit, GONKA_DENOM)] : [],
      proposer: address,
    },
  };

  const result = await client.signAndBroadcast(address, [msg], "auto");
  if (result.code !== 0) {
    throw new Error(`Submit proposal failed: ${result.rawLog}`);
  }
  return { txHash: result.transactionHash };
}

export async function depositToProposal(
  mnemonic: string,
  proposalId: string,
  amount: string
): Promise<{ txHash: string }> {
  const { client, address } = await getSigningClient(mnemonic);

  const msg = {
    typeUrl: "/cosmos.gov.v1beta1.MsgDeposit",
    value: {
      proposalId: BigInt(proposalId),
      depositor: address,
      amount: [coin(amount, GONKA_DENOM)],
    },
  };

  const result = await client.signAndBroadcast(address, [msg], "auto");
  if (result.code !== 0) {
    throw new Error(`Deposit failed: ${result.rawLog}`);
  }
  return { txHash: result.transactionHash };
}

/**
 * Query all validators (REST API).
 */
export async function queryValidators(): Promise<any[]> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(
    `${rest}cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100`
  );
  if (!resp.ok) throw new Error(`Failed to fetch validators: ${resp.status}`);
  const data = await resp.json();
  return data.validators || [];
}

/**
 * Query delegations for an address.
 */
export async function queryDelegations(address: string): Promise<any[]> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(
    `${rest}cosmos/staking/v1beta1/delegations/${address}`
  );
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`Failed to fetch delegations: ${resp.status}`);
  }
  const data = await resp.json();
  return data.delegation_responses || [];
}

/**
 * Query staking rewards for an address.
 */
export async function queryRewards(address: string): Promise<{
  total: string;
  rewards: Array<{ validatorAddress: string; amount: string }>;
}> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(
    `${rest}cosmos/distribution/v1beta1/delegators/${address}/rewards`
  );
  if (!resp.ok) {
    if (resp.status === 404) return { total: "0", rewards: [] };
    throw new Error(`Failed to fetch rewards: ${resp.status}`);
  }
  const data = await resp.json();

  const total = data.total?.[0]?.amount?.split(".")?.[0] || "0";

  const rewards = (data.rewards || []).map((r: any) => ({
    validatorAddress: r.validator_address,
    amount: r.reward?.[0]?.amount?.split(".")?.[0] || "0",
  }));

  return { total, rewards };
}

/**
 * Withdraw all staking rewards.
 */
export async function withdrawRewards(
  mnemonic: string,
  validatorAddresses: string[]
): Promise<{ txHash: string }> {
  const { client, address } = await getSigningClient(mnemonic);

  const msgs = validatorAddresses.map((valAddr) => ({
    typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
    value: {
      delegatorAddress: address,
      validatorAddress: valAddr,
    },
  }));

  const result = await client.signAndBroadcast(address, msgs, "auto");

  if (result.code !== 0) {
    throw new Error(`Withdraw rewards failed: ${result.rawLog}`);
  }

  return { txHash: result.transactionHash };
}

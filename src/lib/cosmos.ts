import { StargateClient, SigningStargateClient, GasPrice, coin, defaultRegistryTypes } from "@cosmjs/stargate";
import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx";
import { DirectSecp256k1HdWallet, Registry, type EncodeObject } from "@cosmjs/proto-signing";
import type { StdFee } from "@cosmjs/amino";
import { Slip10RawIndex, HdPath, Bip39, EnglishMnemonic, Slip10, Slip10Curve, stringToPath } from "@cosmjs/crypto";
import { MsgExecuteContract, MsgInstantiateContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { MsgBeginRedelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx";
import { GONKA_DENOM, GONKA_BECH32_PREFIX, GONKA_COIN_TYPE, GONKA_DECIMALS, GONKA_DISPLAY_DENOM, GONKA_GAS_PRICE } from "./gonka";
import { feeForSimulatedGas } from "./fees";
import { clampGasHeadroom, GAS_HEADROOM_RECOMMENDED } from "./gas-headroom";
import { storageGet, KEYS } from "./storage";
import { getActiveEndpoint } from "./rpc";

const registry = new Registry([
  ...defaultRegistryTypes,
  ["/cosmwasm.wasm.v1.MsgExecuteContract", MsgExecuteContract],
  ["/cosmwasm.wasm.v1.MsgInstantiateContract", MsgInstantiateContract],
  ["/cosmos.staking.v1beta1.MsgBeginRedelegate", MsgBeginRedelegate],
]);

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
    registry,
    gasPrice: GasPrice.fromString(GONKA_GAS_PRICE),
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
 * Coins the account can actually spend. Vesting and other locked balances
 * are excluded. Fees can only be paid from spendable ngonka.
 */
export async function querySpendableBalances(
  address: string
): Promise<{ denom: string; amount: string }[]> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(`${rest}cosmos/bank/v1beta1/spendable_balances/${address}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch spendable balance (${resp.status})`);
  }
  const data = await resp.json();
  const balances = Array.isArray(data.balances) ? data.balances : [];
  return balances.map((coin: { denom?: string; amount?: string }) => ({
    denom: String(coin.denom ?? ""),
    amount: String(coin.amount ?? "0"),
  }));
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

// ------------------------------------------------------------------
//  Known IBC channels (Gonka-side channel IDs)
//  Verified against: curl .../ibc/core/channel/v1/channels | jq ...
// ------------------------------------------------------------------

export interface IbcChannel {
  /** Gonka-side channel ID, e.g. "channel-5" */
  channelId: string;
  /** Human-readable destination chain name */
  chainName: string;
  /** Expected bech32 prefix of the destination address */
  bech32Prefix: string;
}

export const KNOWN_IBC_CHANNELS: IbcChannel[] = [
  { channelId: "channel-5",  chainName: "Kava",    bech32Prefix: "kava"    },
  { channelId: "channel-1",  chainName: "Osmosis",  bech32Prefix: "osmo"    },
  { channelId: "channel-3",  chainName: "Neutron",  bech32Prefix: "neutron" },
  { channelId: "channel-0",  chainName: "Axelar",   bech32Prefix: "axelar"  },
];

// ------------------------------------------------------------------
//  IBC cross-chain transfer (MsgTransfer)
// ------------------------------------------------------------------

export interface EstimatedFee {
  /** Raw gas from simulation, before the user's headroom multiplier. */
  gasUsed: number;
}

async function readGasHeadroom(override?: number): Promise<number> {
  if (override != null && Number.isFinite(Number(override))) {
    return clampGasHeadroom(Number(override));
  }
  const stored = await storageGet<number>(KEYS.GAS_HEADROOM);
  return clampGasHeadroom(stored ?? GAS_HEADROOM_RECOMMENDED);
}

async function estimateMessages(
  mnemonic: string,
  build: (address: string) => readonly EncodeObject[],
  memo = ""
): Promise<EstimatedFee> {
  const { client, address } = await getSigningClient(mnemonic);
  const gasUsed = await client.simulate(address, build(address), memo);
  return { gasUsed };
}

export async function estimateSendFee(
  mnemonic: string,
  recipientAddress: string,
  amount: string,
  denom: string = GONKA_DENOM,
  memo = ""
): Promise<EstimatedFee> {
  return estimateMessages(
    mnemonic,
    (address) => [
      {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          fromAddress: address,
          toAddress: recipientAddress,
          amount: [coin(amount, denom)],
        },
      },
    ],
    memo
  );
}

export async function estimateIbcFee(
  mnemonic: string,
  recipient: string,
  amount: string,
  denom: string,
  sourceChannel: string,
  memo = ""
): Promise<EstimatedFee> {
  const timeoutTimestampNs = BigInt(Math.floor(Date.now() / 1000) + 600) * BigInt(1_000_000_000);
  return estimateMessages(
    mnemonic,
    (address) => [
      {
        typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
        value: MsgTransfer.fromPartial({
          sourcePort: "transfer",
          sourceChannel,
          sender: address,
          receiver: recipient,
          token: coin(amount, denom),
          timeoutTimestamp: timeoutTimestampNs,
        }),
      },
    ],
    memo
  );
}

/**
 * Send tokens from Gonka to another Cosmos chain via IBC.
 *
 * @param mnemonic       Sender's mnemonic
 * @param recipient      Destination address on the target chain (e.g. kava1...)
 * @param amount         Amount in minimal denomination (e.g. uusdt string)
 * @param denom          On-chain denom (ibc/... or native)
 * @param sourceChannel  Gonka-side IBC channel, e.g. "channel-5"
 * @param memo           Optional memo
 */
export async function ibcTransfer(
  mnemonic: string,
  recipient: string,
  amount: string,
  denom: string,
  sourceChannel: string,
  memo = "",
  headroom?: number
): Promise<{ txHash: string; height: number }> {
  const { client, address } = await getSigningClient(mnemonic);

  // Timeout: 10 minutes from now (sendIbcTokens takes seconds)
  const timeoutTimestampSec = Math.floor(Date.now() / 1000) + 600;
  const transferMsg: EncodeObject = {
    typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
    value: MsgTransfer.fromPartial({
      sourcePort: "transfer",
      sourceChannel,
      sender: address,
      receiver: recipient,
      token: coin(amount, denom),
      timeoutTimestamp: BigInt(timeoutTimestampSec) * BigInt(1_000_000_000),
    }),
  };
  const fee = await simulatedGasFee(client, address, [transferMsg], memo, true, headroom);

  const result = await client.sendIbcTokens(
    address,
    recipient,
    coin(amount, denom),
    "transfer",            // IBC transfer port (always "transfer" for x/ibc)
    sourceChannel,
    undefined,             // timeout height (we rely on timestamp instead)
    timeoutTimestampSec,
    fee,
    memo
  );

  if (result.code !== 0) {
    throw new Error(`IBC transfer failed (code ${result.code}): ${result.rawLog}`);
  }

  return { txHash: result.transactionHash, height: result.height };
}

/**
 * Send tokens from the wallet. Defaults to native GNK but accepts any denom (IBC included).
 */
export async function sendTokens(
  mnemonic: string,
  recipientAddress: string,
  amount: string,
  denom: string = GONKA_DENOM,
  memo = "",
  headroom?: number
): Promise<{ txHash: string; height: number }> {
  const { client, address } = await getSigningClient(mnemonic);
  const coins = [coin(amount, denom)];
  const sendMsg: EncodeObject = {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: {
      fromAddress: address,
      toAddress: recipientAddress,
      amount: coins,
    },
  };
  const fee = await simulatedGasFee(client, address, [sendMsg], memo, true, headroom);
  const result = await client.sendTokens(address, recipientAddress, coins, fee, memo);

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
  const amountCoin = coin(amount, GONKA_DENOM);
  const msg: EncodeObject = {
    typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
    value: {
      delegatorAddress: address,
      validatorAddress,
      amount: amountCoin,
    },
  };
  const fee = await simulatedGasFee(client, address, [msg]);
  const result = await client.delegateTokens(address, validatorAddress, amountCoin, fee);

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
  const amountCoin = coin(amount, GONKA_DENOM);
  const msg: EncodeObject = {
    typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
    value: {
      delegatorAddress: address,
      validatorAddress,
      amount: amountCoin,
    },
  };
  const fee = await simulatedGasFee(client, address, [msg]);
  const result = await client.undelegateTokens(address, validatorAddress, amountCoin, fee);

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

export interface GovTallyParams {
  quorum: string;
  threshold: string;
  vetoThreshold: string;
}

export async function queryGovParams(): Promise<GovTallyParams> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(
    `${rest}cosmos/gov/v1/params/tallying`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!resp.ok) throw new Error(`Failed to fetch gov params: ${resp.status}`);
  const data = await resp.json();
  const p = data.tally_params || data.params || {};
  return {
    quorum: p.quorum || "0",
    threshold: p.threshold || "0",
    vetoThreshold: p.veto_threshold || "0",
  };
}

export async function queryBondedTokens(): Promise<string> {
  const { rest } = await getActiveEndpoint();
  const resp = await fetch(
    `${rest}cosmos/staking/v1beta1/pool`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!resp.ok) throw new Error(`Failed to fetch staking pool: ${resp.status}`);
  const data = await resp.json();
  return data.pool?.bonded_tokens || "0";
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

/**
 * Simulate gas and attach a zero coin amount. Used for governance votes,
 * which the chain does not charge.
 */
async function simulatedGasFee(
  client: SigningStargateClient,
  address: string,
  messages: readonly EncodeObject[],
  memo = "",
  pay = true,
  headroom?: number
): Promise<StdFee> {
  const gasUsed = await client.simulate(address, messages, memo);
  const priced = feeForSimulatedGas(gasUsed, await readGasHeadroom(headroom));
  return {
    amount: [coin(pay ? priced.amount : "0", GONKA_DENOM)],
    gas: priced.gas,
  };
}

async function zeroFee(
  client: SigningStargateClient,
  address: string,
  messages: readonly EncodeObject[],
  memo = ""
): Promise<StdFee> {
  return simulatedGasFee(client, address, messages, memo, false);
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

  // Votes are not charged after v0.2.16. A zero fee lets an account vote
  // when its GNK is vesting and cannot pay gas.
  const fee = await zeroFee(client, address, [msg]);
  const result = await client.signAndBroadcast(address, [msg], fee);
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

  const fee = await simulatedGasFee(client, address, [msg]);
  const result = await client.signAndBroadcast(address, [msg], fee);
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

  const fee = await simulatedGasFee(client, address, [msg]);
  const result = await client.signAndBroadcast(address, [msg], fee);
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

  const fee = await simulatedGasFee(client, address, msgs);
  const result = await client.signAndBroadcast(address, msgs, fee);

  if (result.code !== 0) {
    throw new Error(`Withdraw rewards failed: ${result.rawLog}`);
  }

  return { txHash: result.transactionHash };
}

/**
 * Redelegate stake from one validator to another. Used by the
 * inferenced-runner's `tx staking redelegate` mapping.
 */
export async function redelegateTokens(
  mnemonic: string,
  srcValidator: string,
  dstValidator: string,
  amount: string,
  memo = ""
): Promise<{ txHash: string }> {
  const { client, address } = await getSigningClient(mnemonic);

  const msg = {
    typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
    value: {
      delegatorAddress: address,
      validatorSrcAddress: srcValidator,
      validatorDstAddress: dstValidator,
      amount: coin(amount, GONKA_DENOM),
    },
  };

  const fee = await simulatedGasFee(client, address, [msg], memo);
  const result = await client.signAndBroadcast(address, [msg], fee, memo);
  if (result.code !== 0) {
    throw new Error(`Redelegation failed: ${result.rawLog}`);
  }
  return { txHash: result.transactionHash };
}

/**
 * Instantiate a CosmWasm contract from a stored code id.
 * Mirrors `inferenced tx wasm instantiate <code-id> <init-json> --label …`.
 */
export async function instantiateContract(
  mnemonic: string,
  codeId: string,
  initMsg: object,
  label: string,
  admin: string | null,
  funds: { denom: string; amount: string }[] = [],
  memo = ""
): Promise<{ txHash: string; height: number; contractAddress: string | null }> {
  const { client, address } = await getSigningClient(mnemonic);

  const msg = {
    typeUrl: "/cosmwasm.wasm.v1.MsgInstantiateContract",
    value: {
      sender: address,
      admin: admin || "",
      codeId: BigInt(codeId),
      label,
      msg: new TextEncoder().encode(JSON.stringify(initMsg)),
      funds: funds.map((f) => coin(f.amount, f.denom)),
    },
  };

  const fee = await simulatedGasFee(client, address, [msg], memo);
  const result = await client.signAndBroadcast(address, [msg], fee, memo);
  if (result.code !== 0) {
    throw new Error(`Contract instantiation failed: ${result.rawLog}`);
  }

  // Parse the instantiated contract address from events when present.
  let contractAddress: string | null = null;
  for (const ev of result.events || []) {
    if (ev.type === "instantiate") {
      const attr = ev.attributes.find((a) => a.key === "_contract_address");
      if (attr) contractAddress = attr.value;
    }
  }

  return { txHash: result.transactionHash, height: result.height, contractAddress };
}

/**
 * Execute a CosmWasm contract message.
 * `funds` is an optional array of coins to send along (e.g. for Buy on GNS marketplace).
 */
export async function executeContract(
  mnemonic: string,
  contractAddress: string,
  msg: object,
  funds: { denom: string; amount: string }[] = []
): Promise<{ txHash: string; height: number }> {
  const { client, address } = await getSigningClient(mnemonic);

  const executeMsg = {
    typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
    value: {
      sender: address,
      contract: contractAddress,
      msg: new TextEncoder().encode(JSON.stringify(msg)),
      funds: funds.map((f) => coin(f.amount, f.denom)),
    },
  };

  const fee = await simulatedGasFee(client, address, [executeMsg]);
  const result = await client.signAndBroadcast(address, [executeMsg], fee);

  if (result.code !== 0) {
    throw new Error(`Contract execution failed: ${result.rawLog}`);
  }

  return { txHash: result.transactionHash, height: result.height };
}

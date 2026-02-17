import { StargateClient, SigningStargateClient, GasPrice, coin } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Slip10RawIndex, HdPath, Bip39, EnglishMnemonic, Slip10, Slip10Curve, stringToPath } from "@cosmjs/crypto";
import { GONKA_DENOM, GONKA_BECH32_PREFIX, GONKA_COIN_TYPE } from "./gonka";
import { getActiveEndpoint } from "./rpc";

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
 * Send tokens from the wallet.
 */
export async function sendTokens(
  mnemonic: string,
  recipientAddress: string,
  amount: string,
  memo = ""
): Promise<{ txHash: string; height: number }> {
  const { client, address } = await getSigningClient(mnemonic);
  const result = await client.sendTokens(
    address,
    recipientAddress,
    [coin(amount, GONKA_DENOM)],
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

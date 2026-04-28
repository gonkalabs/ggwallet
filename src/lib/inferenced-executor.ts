/**
 * Dispatches a parsed `inferenced` Intent (from inferenced-parser.ts)
 * to the wallet's existing signing helpers in cosmos.ts. No new chain
 * code lives here — this module is a thin glue layer.
 *
 * The executor lives in the service worker; the popup calls into it via
 * the `RUN_INFERENCED_CMD` message handler in background/index.ts.
 */

import {
  sendTokens,
  delegateTokens,
  undelegateTokens,
  redelegateTokens,
  withdrawRewards,
  voteProposal,
  depositToProposal,
  executeContract,
  instantiateContract,
} from "./cosmos";
import { getActiveEndpoint } from "./rpc";
import type { Intent, QueryIntent } from "./inferenced-parser";
import { isQueryIntent } from "./inferenced-parser";

export interface RunResult {
  txHash: string;
  height?: number;
  /** Set on `tx wasm instantiate` to the deployed contract address. */
  contractAddress?: string | null;
  intentKind: Intent["kind"];
}

export interface QueryResult {
  /** The raw JSON the chain returned (or `null` for 404-style misses). */
  json: any;
  /** Subpath relative to REST base — useful for the UI debug strip. */
  endpoint: string;
  intentKind: Intent["kind"];
}

/**
 * Run a parsed Intent. Throws on validation / execution errors —
 * callers should catch and surface a friendly message.
 *
 * Only handles signing intents (`tx …`). Query intents are rejected up
 * front so the type guard narrows the switch to the `tx` arms only.
 */
export async function executeIntent(
  intent: Intent,
  mnemonic: string,
): Promise<RunResult> {
  if (isQueryIntent(intent)) {
    throw new Error("executeIntent received a query intent. Call runQuery() instead.");
  }
  switch (intent.kind) {
    case "bank.send": {
      const r = await sendTokens(
        mnemonic,
        intent.toAddress,
        intent.amount,
        intent.denom,
        intent.memo,
      );
      return { ...r, intentKind: intent.kind };
    }

    case "wasm.execute": {
      const r = await executeContract(
        mnemonic,
        intent.contract,
        intent.msg,
        intent.funds,
      );
      return { ...r, intentKind: intent.kind };
    }

    case "wasm.instantiate": {
      const r = await instantiateContract(
        mnemonic,
        intent.codeId,
        intent.initMsg,
        intent.label,
        intent.admin,
        intent.funds,
        intent.memo,
      );
      return { ...r, intentKind: intent.kind };
    }

    case "staking.delegate": {
      const r = await delegateTokens(mnemonic, intent.validator, intent.amount);
      return { ...r, intentKind: intent.kind };
    }

    case "staking.unbond": {
      const r = await undelegateTokens(mnemonic, intent.validator, intent.amount);
      return { ...r, intentKind: intent.kind };
    }

    case "staking.redelegate": {
      const r = await redelegateTokens(
        mnemonic,
        intent.srcValidator,
        intent.dstValidator,
        intent.amount,
        intent.memo,
      );
      return { ...r, intentKind: intent.kind };
    }

    case "distribution.withdraw-rewards": {
      const r = await withdrawRewards(mnemonic, [intent.validator]);
      return { ...r, intentKind: intent.kind };
    }

    case "distribution.withdraw-all-rewards": {
      // The CLI side queries the chain for all delegations the sender has
      // and withdraws from each. We don't have a "list all delegations"
      // helper in cosmos.ts today, so we fail clearly rather than do a
      // partial withdraw silently.
      throw new Error(
        "`tx distribution withdraw-all-rewards` isn't supported yet — pass a specific validator with `withdraw-rewards <validator>`.",
      );
    }

    case "gov.vote": {
      const r = await voteProposal(mnemonic, intent.proposalId, intent.option);
      return { ...r, intentKind: intent.kind };
    }

    case "gov.deposit": {
      const r = await depositToProposal(mnemonic, intent.proposalId, intent.amount);
      return { ...r, intentKind: intent.kind };
    }

    default: {
      // Compile-time exhaustiveness check — `intent` should be `never` here
      // because every TxIntent kind is handled above.
      const _exhaustive: never = intent;
      throw new Error(`Unhandled intent: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
//  Read-only query runner — REST-based
//
//  Cosmos SDK / CosmWasm REST paths under {rest}. The wallet's active
//  endpoint already routes through rpc.gonka.gg when an API key is
//  available, so paid-tier rate-limits / faster ClickHouse paths apply
//  transparently here too.
// ---------------------------------------------------------------------------

async function restGet(path: string): Promise<{ json: any; endpoint: string }> {
  const { rest } = await getActiveEndpoint();
  // `rest` always ends with `/`; `path` always starts with one.
  const base = rest.replace(/\/+$/, "");
  const url = `${base}${path}`;
  const resp = await fetch(url);
  const endpoint = url;
  if (!resp.ok) {
    let body = "";
    try { body = await resp.text(); } catch { /* ignore */ }
    throw new Error(
      `Query failed (${resp.status}): ${body.slice(0, 200) || resp.statusText}`,
    );
  }
  const json = await resp.json();
  return { json, endpoint };
}

/**
 * Execute a parsed query Intent. No signing, no wallet unlock required.
 */
export async function runQuery(intent: QueryIntent): Promise<QueryResult> {
  const enc = encodeURIComponent;

  switch (intent.kind) {
    case "query.bank.balances": {
      const { json, endpoint } = await restGet(
        `/cosmos/bank/v1beta1/balances/${enc(intent.address)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }
    case "query.bank.balance": {
      const { json, endpoint } = await restGet(
        `/cosmos/bank/v1beta1/balances/${enc(intent.address)}/by_denom?denom=${enc(intent.denom)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }

    case "query.staking.delegations": {
      const { json, endpoint } = await restGet(
        `/cosmos/staking/v1beta1/delegations/${enc(intent.address)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }
    case "query.staking.delegation": {
      const { json, endpoint } = await restGet(
        `/cosmos/staking/v1beta1/validators/${enc(intent.validator)}/delegations/${enc(intent.address)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }
    case "query.staking.validator": {
      const { json, endpoint } = await restGet(
        `/cosmos/staking/v1beta1/validators/${enc(intent.validator)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }
    case "query.staking.validators": {
      const { json, endpoint } = await restGet(
        `/cosmos/staking/v1beta1/validators?pagination.limit=200`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }

    case "query.distribution.rewards": {
      const { json, endpoint } = await restGet(
        `/cosmos/distribution/v1beta1/delegators/${enc(intent.address)}/rewards`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }
    case "query.distribution.rewards-from-validator": {
      const { json, endpoint } = await restGet(
        `/cosmos/distribution/v1beta1/delegators/${enc(intent.address)}/rewards/${enc(intent.validator)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }

    case "query.gov.proposal": {
      // Try v1 first; fall back to v1beta1 for older nodes.
      try {
        const { json, endpoint } = await restGet(
          `/cosmos/gov/v1/proposals/${enc(intent.proposalId)}`,
        );
        return { json, endpoint, intentKind: intent.kind };
      } catch {
        const { json, endpoint } = await restGet(
          `/cosmos/gov/v1beta1/proposals/${enc(intent.proposalId)}`,
        );
        return { json, endpoint, intentKind: intent.kind };
      }
    }
    case "query.gov.proposals": {
      try {
        const { json, endpoint } = await restGet(
          `/cosmos/gov/v1/proposals?pagination.limit=200`,
        );
        return { json, endpoint, intentKind: intent.kind };
      } catch {
        const { json, endpoint } = await restGet(
          `/cosmos/gov/v1beta1/proposals?pagination.limit=200`,
        );
        return { json, endpoint, intentKind: intent.kind };
      }
    }
    case "query.gov.tally": {
      try {
        const { json, endpoint } = await restGet(
          `/cosmos/gov/v1/proposals/${enc(intent.proposalId)}/tally`,
        );
        return { json, endpoint, intentKind: intent.kind };
      } catch {
        const { json, endpoint } = await restGet(
          `/cosmos/gov/v1beta1/proposals/${enc(intent.proposalId)}/tally`,
        );
        return { json, endpoint, intentKind: intent.kind };
      }
    }

    case "query.auth.account": {
      const { json, endpoint } = await restGet(
        `/cosmos/auth/v1beta1/accounts/${enc(intent.address)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }

    case "query.tx": {
      const hash = intent.hash.replace(/^0x/i, "").toUpperCase();
      const { json, endpoint } = await restGet(`/cosmos/tx/v1beta1/txs/${enc(hash)}`);
      return { json, endpoint, intentKind: intent.kind };
    }

    case "query.wasm.smart": {
      // CosmWasm REST takes the query as base64-encoded JSON in the path.
      const queryBytes = new TextEncoder().encode(JSON.stringify(intent.query));
      const queryB64 = bytesToBase64(queryBytes);
      const { json, endpoint } = await restGet(
        `/cosmwasm/wasm/v1/contract/${enc(intent.contract)}/smart/${enc(queryB64)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }

    case "query.wasm.code-info": {
      const { json, endpoint } = await restGet(
        `/cosmwasm/wasm/v1/code/${enc(intent.codeId)}`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }
    case "query.wasm.list-codes": {
      const { json, endpoint } = await restGet(
        `/cosmwasm/wasm/v1/code?pagination.limit=200`,
      );
      return { json, endpoint, intentKind: intent.kind };
    }

    default: {
      // Compile-time exhaustiveness check.
      const _exhaustive: never = intent;
      throw new Error(`Unhandled query intent: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Service-worker-safe base64 encoding without spreading into String.fromCharCode
  // (which can blow the call stack on large inputs).
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

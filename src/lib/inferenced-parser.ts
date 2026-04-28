/**
 * `inferenced` (Gonka CLI) command parser.
 *
 * Takes a raw command string the user pasted from a docs page or guide
 * and produces a normalized {@link Intent} the wallet can dispatch
 * through its existing signing helpers — `sendTokens`, `executeContract`,
 * `delegateTokens`, etc.
 *
 * The parser does NO chain I/O. It validates structure + flag shape +
 * chain-id consistency, then hands off to {@link executeIntent} (in
 * inferenced-executor.ts) which talks to cosmos.ts.
 *
 * Supported subcommands (v1):
 *   tx bank send <from> <to> <amount>
 *   tx wasm execute <contract> <json> [--amount <coins>]
 *   tx wasm instantiate <code_id> <json> --label <l> [--amount <coins>] [--admin <a>] [--no-admin]
 *   tx staking delegate <validator> <amount>
 *   tx staking unbond <validator> <amount>
 *   tx staking redelegate <src-val> <dst-val> <amount>
 *   tx distribution withdraw-rewards <validator>
 *   tx distribution withdraw-all-rewards
 *   tx gov vote <proposal-id> <option>
 *   tx gov deposit <proposal-id> <amount>
 *
 * Anything else is returned as `kind: "unsupported"` with a human
 * reason — the wallet shows the raw breakdown but disables Execute.
 *
 * Flags handled:
 *   --from <name>          ignored (uses active wallet); warning if mismatch
 *   --chain-id <id>        ERROR if it differs from the wallet's chain
 *   --node <url>           ignored (uses active RPC); soft warning on mismatch
 *   --keyring-backend, -y, --output, --gas, --gas-adjustment, --gas-prices,
 *   --broadcast-mode, --sign-mode, --offline, --generate-only, --home, etc.
 *                          silently ignored
 *   --memo / --note <s>    honored
 *   --amount <coins>       honored as funds (wasm execute / instantiate)
 *   --fees <coins>         honored
 *   --label <s>, --admin <a>, --no-admin   honored (wasm instantiate)
 */

import { GONKA_CHAIN_ID, GONKA_DENOM } from "./gonka";

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

export interface Coin {
  denom: string;
  amount: string;
}

export type VoteOption =
  | "VOTE_OPTION_YES"
  | "VOTE_OPTION_NO"
  | "VOTE_OPTION_ABSTAIN"
  | "VOTE_OPTION_NO_WITH_VETO";

export type Intent =
  // ---- Queries (read-only; no signing) ----
  | { kind: "query.bank.balances"; address: string }
  | { kind: "query.bank.balance"; address: string; denom: string }
  | { kind: "query.staking.delegations"; address: string }
  | { kind: "query.staking.delegation"; address: string; validator: string }
  | { kind: "query.staking.validator"; validator: string }
  | { kind: "query.staking.validators" }
  | { kind: "query.distribution.rewards"; address: string }
  | { kind: "query.distribution.rewards-from-validator"; address: string; validator: string }
  | { kind: "query.gov.proposal"; proposalId: string }
  | { kind: "query.gov.proposals" }
  | { kind: "query.gov.tally"; proposalId: string }
  | { kind: "query.auth.account"; address: string }
  | { kind: "query.tx"; hash: string }
  | {
      kind: "query.wasm.smart";
      contract: string;
      query: object;
      queryRaw: string;
    }
  | { kind: "query.wasm.code-info"; codeId: string }
  | { kind: "query.wasm.list-codes" }
  // ---- Transactions (require signing) ----
  | {
      kind: "bank.send";
      toAddress: string;
      amount: string;
      denom: string;
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "wasm.execute";
      contract: string;
      msg: object;
      msgRaw: string;
      funds: Coin[];
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "wasm.instantiate";
      codeId: string;
      initMsg: object;
      initMsgRaw: string;
      label: string;
      admin: string | null;
      funds: Coin[];
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "staking.delegate";
      validator: string;
      amount: string;
      denom: string;
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "staking.unbond";
      validator: string;
      amount: string;
      denom: string;
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "staking.redelegate";
      srcValidator: string;
      dstValidator: string;
      amount: string;
      denom: string;
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "distribution.withdraw-rewards";
      validator: string;
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "distribution.withdraw-all-rewards";
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "gov.vote";
      proposalId: string;
      option: VoteOption;
      memo: string;
      fees?: Coin[];
    }
  | {
      kind: "gov.deposit";
      proposalId: string;
      amount: string;
      denom: string;
      memo: string;
      fees?: Coin[];
    };

export type IntentKind = Intent["kind"];

/** Subtype of {@link Intent} containing only the read-only `query.*` arms. */
export type QueryIntent = Extract<Intent, { kind: `query.${string}` }>;
/** Subtype of {@link Intent} containing only the signing `tx` arms. */
export type TxIntent = Exclude<Intent, QueryIntent>;

/** True for read-only `query …` intents (no signing required). */
export function isQueryIntent(intent: Intent): intent is QueryIntent {
  return intent.kind.startsWith("query.");
}

export interface Warning {
  /** "info" warnings are not blocking; "error" warnings disable Execute. */
  level: "info" | "error";
  message: string;
}

export type ParsedCommand =
  | {
      ok: true;
      intent: Intent;
      tokens: string[];
      flags: Record<string, string | true>;
      warnings: Warning[];
    }
  | {
      ok: false;
      error: string;
      tokens: string[];
      flags: Record<string, string | true>;
      warnings: Warning[];
      /** Best-effort identification of the subcommand even when we can't run it. */
      subcommand?: string;
    };

// ---------------------------------------------------------------------------
//  Shell tokenizer
//
//  Handles single quotes (verbatim, no escapes), double quotes (with
//  \\, \", \n, \r, \t escapes), bare-token backslash escapes, and
//  multi-line commands joined by a trailing backslash.
//
//  Newlines outside quotes act as whitespace. Comments (`# …`) outside
//  quotes are stripped to the end of the line.
// ---------------------------------------------------------------------------

class TokenizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenizerError";
  }
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inToken = false;
  let i = 0;
  const n = input.length;

  const flushIfAny = () => {
    if (inToken) {
      tokens.push(cur);
      cur = "";
      inToken = false;
    }
  };

  while (i < n) {
    const c = input[i];

    // Whitespace (incl. newline) outside of quotes ends the current token.
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      flushIfAny();
      i++;
      continue;
    }

    // Comment to end-of-line.
    if (c === "#" && !inToken) {
      while (i < n && input[i] !== "\n") i++;
      continue;
    }

    // Backslash at top-level — line continuation if followed by newline,
    // otherwise escapes the next char into the current token.
    if (c === "\\") {
      const next = input[i + 1];
      if (next === "\n" || next === "\r") {
        // Line continuation: drop both characters.
        i += next === "\r" && input[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (next === undefined) {
        throw new TokenizerError("Trailing backslash with nothing to escape");
      }
      cur += next;
      inToken = true;
      i += 2;
      continue;
    }

    // Single-quoted string — verbatim, no escapes.
    if (c === "'") {
      inToken = true;
      i++;
      while (i < n && input[i] !== "'") {
        cur += input[i++];
      }
      if (i >= n) throw new TokenizerError("Unterminated single quote");
      i++; // consume closing '
      continue;
    }

    // Double-quoted string — supports \\, \", \n, \r, \t escapes.
    if (c === '"') {
      inToken = true;
      i++;
      while (i < n && input[i] !== '"') {
        if (input[i] === "\\") {
          const esc = input[i + 1];
          if (esc === undefined) throw new TokenizerError("Trailing backslash inside double quotes");
          switch (esc) {
            case "n": cur += "\n"; break;
            case "r": cur += "\r"; break;
            case "t": cur += "\t"; break;
            case "\\": cur += "\\"; break;
            case '"': cur += '"'; break;
            case "$": cur += "$"; break;
            case "`": cur += "`"; break;
            default:
              // Bash leaves unknown escapes as-is (\x → \x). We do the same.
              cur += "\\" + esc;
          }
          i += 2;
        } else {
          cur += input[i++];
        }
      }
      if (i >= n) throw new TokenizerError("Unterminated double quote");
      i++; // consume closing "
      continue;
    }

    // Default: literal char, append to current token.
    cur += c;
    inToken = true;
    i++;
  }

  flushIfAny();
  return tokens;
}

// ---------------------------------------------------------------------------
//  Flag extraction
//
//  Splits a positional+flag stream into:
//    - positionals: array of bare tokens
//    - flags: map of name → value (value is `true` for boolean flags)
//
//  Accepts both `--key value` and `--key=value`. Unknown short flags
//  (e.g. `-y`) are treated as boolean. Cosmos CLI doesn't have multi-char
//  short bundles, so we don't try to split them.
// ---------------------------------------------------------------------------

const BOOLEAN_FLAGS = new Set([
  "y",
  "yes",
  "no-admin",
  "offline",
  "generate-only",
  "dry-run",
  "force",
]);

interface FlagsAndPositionals {
  positionals: string[];
  flags: Record<string, string | true>;
}

export function splitFlags(tokens: string[]): FlagsAndPositionals {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const name = (eq >= 0 ? t.slice(2, eq) : t.slice(2)).trim();
      if (!name) {
        positionals.push(t);
        continue;
      }
      if (eq >= 0) {
        flags[name] = t.slice(eq + 1);
        continue;
      }
      const next = tokens[i + 1];
      if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("-")) {
        flags[name] = true;
      } else {
        flags[name] = next;
        i++;
      }
      continue;
    }

    if (t.startsWith("-") && t.length > 1 && t !== "-") {
      const name = t.slice(1);
      const next = tokens[i + 1];
      if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("-")) {
        flags[name] = true;
      } else {
        flags[name] = next;
        i++;
      }
      continue;
    }

    positionals.push(t);
  }

  return { positionals, flags };
}

// ---------------------------------------------------------------------------
//  Coin / amount parsing
//
//  CLI coin format: "<amount><denom>" e.g. "5000000ngonka". Multiple coins
//  comma-separated: "100ngonka,5uatom".
// ---------------------------------------------------------------------------

const COIN_RE = /^([0-9]+)([a-zA-Z][a-zA-Z0-9/_-]*)$/;

export function parseCoinsString(s: string): Coin[] {
  if (!s) return [];
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const out: Coin[] = [];
  for (const p of parts) {
    const m = p.match(COIN_RE);
    if (!m) throw new Error(`Invalid coin string: "${p}" (expected e.g. 100ngonka)`);
    out.push({ amount: m[1], denom: m[2] });
  }
  return out;
}

/** Single coin (e.g. delegate amount). Throws when the string isn't `<n><denom>`. */
export function parseSingleCoin(s: string): Coin {
  const list = parseCoinsString(s);
  if (list.length !== 1) {
    throw new Error(`Expected a single coin, got: "${s}"`);
  }
  return list[0];
}

// ---------------------------------------------------------------------------
//  Vote option parsing
// ---------------------------------------------------------------------------

const VOTE_OPTION_MAP: Record<string, VoteOption> = {
  yes: "VOTE_OPTION_YES",
  y: "VOTE_OPTION_YES",
  "1": "VOTE_OPTION_YES",
  abstain: "VOTE_OPTION_ABSTAIN",
  "2": "VOTE_OPTION_ABSTAIN",
  no: "VOTE_OPTION_NO",
  n: "VOTE_OPTION_NO",
  "3": "VOTE_OPTION_NO",
  no_with_veto: "VOTE_OPTION_NO_WITH_VETO",
  "no-with-veto": "VOTE_OPTION_NO_WITH_VETO",
  nowithveto: "VOTE_OPTION_NO_WITH_VETO",
  nwv: "VOTE_OPTION_NO_WITH_VETO",
  "4": "VOTE_OPTION_NO_WITH_VETO",
};

export function parseVoteOption(s: string): VoteOption {
  const key = s.trim().toLowerCase();
  const v = VOTE_OPTION_MAP[key];
  if (!v) throw new Error(`Unknown vote option: "${s}" (expected yes / no / abstain / no_with_veto)`);
  return v;
}

// ---------------------------------------------------------------------------
//  Top-level parse entry
// ---------------------------------------------------------------------------

const KNOWN_BINARIES = ["inferenced", "gonkad"];

export function parseCommand(input: string, walletAddress?: string): ParsedCommand {
  const warnings: Warning[] = [];
  let tokens: string[];
  try {
    tokens = tokenize(input);
  } catch (e: any) {
    return {
      ok: false,
      error: e.message || "Failed to tokenize command",
      tokens: [],
      flags: {},
      warnings,
    };
  }

  if (tokens.length === 0) {
    return { ok: false, error: "Empty command", tokens, flags: {}, warnings };
  }

  // Drop the leading binary if it looks like one (`./inferenced`, `inferenced`,
  // `/path/to/inferenced`, etc.).
  const first = tokens[0];
  const trimmed = first.replace(/^\.\//, "").split("/").pop() || first;
  if (KNOWN_BINARIES.includes(trimmed)) tokens = tokens.slice(1);

  if (tokens.length === 0) {
    return { ok: false, error: "Command has no arguments after the binary", tokens, flags: {}, warnings };
  }

  // We handle two roots: `tx …` (signs + broadcasts) and `query …` (read-only).
  const root = tokens[0];
  const isQuery = root === "query" || root === "q";
  const isTx = root === "tx";
  if (!isQuery && !isTx) {
    return {
      ok: false,
      error: `Unsupported root command: "${root}". Expected "tx" or "query".`,
      tokens,
      flags: {},
      warnings,
      subcommand: root,
    };
  }

  const rest = tokens.slice(1);
  if (rest.length === 0) {
    return {
      ok: false,
      error: `\`${root}\` requires a module + action`,
      tokens,
      flags: {},
      warnings,
    };
  }

  const { positionals, flags } = splitFlags(rest);

  // Common flag normalization + validation.
  const memo =
    typeof flags["memo"] === "string"
      ? (flags["memo"] as string)
      : typeof flags["note"] === "string"
      ? (flags["note"] as string)
      : "";

  let fees: Coin[] | undefined;
  if (typeof flags["fees"] === "string") {
    try {
      fees = parseCoinsString(flags["fees"] as string);
    } catch (e: any) {
      warnings.push({ level: "error", message: `--fees: ${e.message}` });
    }
  }

  // --chain-id MUST match the wallet's chain. Only meaningful for `tx`;
  // queries are read-only and don't sign anything, so we treat a mismatch
  // as informational there.
  const chainId = typeof flags["chain-id"] === "string" ? (flags["chain-id"] as string) : null;
  if (chainId && chainId !== GONKA_CHAIN_ID) {
    warnings.push({
      level: isTx ? "error" : "info",
      message: isTx
        ? `--chain-id "${chainId}" does not match the wallet's chain "${GONKA_CHAIN_ID}". Refusing to sign.`
        : `--chain-id "${chainId}" doesn't match the wallet's chain "${GONKA_CHAIN_ID}". Running the query against the wallet's RPC anyway.`,
    });
  }

  // --from / -from is informational only; we sign with the active wallet.
  const fromName =
    typeof flags["from"] === "string" ? (flags["from"] as string) : null;
  if (fromName && isTx) {
    if (walletAddress && fromName === walletAddress) {
      // exact address match — silent
    } else if (fromName.startsWith("<") && fromName.endsWith(">")) {
      // placeholder like "<your-key>" — silent
    } else {
      warnings.push({
        level: "info",
        message: `--from "${fromName}" is ignored — the wallet signs with the currently active key.`,
      });
    }
  }

  // --node is informational only.
  if (typeof flags["node"] === "string") {
    warnings.push({
      level: "info",
      message: `--node ${flags["node"]} is ignored — the wallet uses its configured RPC endpoint.`,
    });
  }

  // ---- Module / action dispatch ----------------------------------------
  const rootKey = isQuery ? "query" : "tx";
  const subcommand = positionals[0]
    ? `${rootKey} ${positionals[0]} ${positionals[1] || ""}`.trim()
    : rootKey;

  try {
    const intent = isQuery
      ? parseQueryIntent(positionals, flags, walletAddress, warnings)
      : parseIntent(positionals, flags, memo, fees, warnings);
    const blocking = warnings.some((w) => w.level === "error");
    if (blocking) {
      return {
        ok: false,
        error: warnings.find((w) => w.level === "error")!.message,
        tokens,
        flags,
        warnings,
        subcommand: intentSubcommand(intent),
      };
    }
    return { ok: true, intent, tokens, flags, warnings };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Failed to parse command",
      tokens,
      flags,
      warnings,
      subcommand,
    };
  }
}

function intentSubcommand(intent: Intent): string {
  if (intent.kind.startsWith("query.")) return intent.kind.replace(/\./g, " ");
  return `tx ${intent.kind.replace(/\./g, " ")}`;
}

// ---------------------------------------------------------------------------
//  Per-module parsers — queries (read-only)
// ---------------------------------------------------------------------------

function parseQueryIntent(
  positionals: string[],
  flags: Record<string, string | true>,
  walletAddress: string | undefined,
  _warnings: Warning[],
): Intent {
  const [module_, action, ...rest] = positionals;

  if (!module_) {
    throw new Error("Missing module + action (expected e.g. `query bank balances …`)");
  }
  // `query tx <hash>` is a top-level shape — the action is the hash itself.
  if (module_ === "tx") {
    const hash = action;
    if (!hash) throw new Error("`query tx` expects: <hash>");
    return { kind: "query.tx", hash };
  }
  if (!action) {
    throw new Error("Missing action (expected e.g. `query bank balances`)");
  }

  const path = `${module_} ${action}`;

  // Helper — pick the address for queries that take one positional address,
  // falling back to the active wallet's address when the user wrote `me`,
  // `--self`, or omitted the arg entirely.
  const addrOrSelf = (a?: string): string => {
    if (a && a !== "me" && a !== "self") return a;
    if (walletAddress) return walletAddress;
    throw new Error("This query needs an address. Pass one positional or unlock a wallet first.");
  };

  switch (path) {
    case "bank balances": {
      return { kind: "query.bank.balances", address: addrOrSelf(rest[0]) };
    }
    case "bank balance": {
      // Two CLI shapes are common:
      //   inferenced query bank balance <addr> <denom>
      //   inferenced query bank balance <addr> --denom <denom>
      const address = addrOrSelf(rest[0]);
      const denom =
        typeof flags["denom"] === "string"
          ? (flags["denom"] as string)
          : rest[1];
      if (!denom) throw new Error("`query bank balance` expects: <addr> <denom> (or --denom <denom>)");
      return { kind: "query.bank.balance", address, denom };
    }

    case "staking delegations":
    case "staking delegations-from": {
      return { kind: "query.staking.delegations", address: addrOrSelf(rest[0]) };
    }
    case "staking delegation": {
      if (rest.length < 2) {
        throw new Error("`query staking delegation` expects: <delegator> <validator>");
      }
      return {
        kind: "query.staking.delegation",
        address: addrOrSelf(rest[0]),
        validator: rest[1],
      };
    }
    case "staking validator": {
      if (rest.length < 1) {
        throw new Error("`query staking validator` expects: <validator>");
      }
      return { kind: "query.staking.validator", validator: rest[0] };
    }
    case "staking validators": {
      return { kind: "query.staking.validators" };
    }

    case "distribution rewards": {
      // `query distribution rewards <delegator>` — total rewards.
      // `query distribution rewards <delegator> <validator>` — per-validator.
      const delegator = addrOrSelf(rest[0]);
      if (rest[1]) {
        return {
          kind: "query.distribution.rewards-from-validator",
          address: delegator,
          validator: rest[1],
        };
      }
      return { kind: "query.distribution.rewards", address: delegator };
    }

    case "gov proposal": {
      const id = rest[0];
      if (!id || !/^\d+$/.test(id)) {
        throw new Error("`query gov proposal` expects a numeric proposal id");
      }
      return { kind: "query.gov.proposal", proposalId: id };
    }
    case "gov proposals": {
      return { kind: "query.gov.proposals" };
    }
    case "gov tally": {
      const id = rest[0];
      if (!id || !/^\d+$/.test(id)) {
        throw new Error("`query gov tally` expects a numeric proposal id");
      }
      return { kind: "query.gov.tally", proposalId: id };
    }

    case "auth account": {
      return { kind: "query.auth.account", address: addrOrSelf(rest[0]) };
    }

    case "wasm contract-state": {
      // `query wasm contract-state smart <contract> <json>`
      // `query wasm contract-state raw <contract> <hex_key>` — not yet
      const sub = rest[0];
      if (sub === "smart") {
        if (rest.length < 3) {
          throw new Error("`query wasm contract-state smart` expects: <contract> <query-json>");
        }
        const contract = rest[1];
        const queryRaw = rest[2];
        let query: object;
        try {
          query = JSON.parse(queryRaw);
        } catch (e: any) {
          throw new Error(`Invalid query JSON: ${e.message}`);
        }
        return { kind: "query.wasm.smart", contract, query, queryRaw };
      }
      throw new Error(
        `\`query wasm contract-state ${sub || ""}\` is not supported yet — use \`smart\`.`,
      );
    }
    case "wasm code-info": {
      const codeId = rest[0];
      if (!codeId || !/^\d+$/.test(codeId)) {
        throw new Error("`query wasm code-info` expects a numeric code id");
      }
      return { kind: "query.wasm.code-info", codeId };
    }
    case "wasm list-codes":
    case "wasm list-code": {
      return { kind: "query.wasm.list-codes" };
    }

    default:
      throw new Error(
        `Unsupported query: \`query ${path}\` is not handled by GG Wallet yet. ` +
          `Supported: query bank balances|balance, query staking delegations|delegation|validator|validators, ` +
          `query distribution rewards, query gov proposal|proposals|tally, query auth account, ` +
          `query wasm contract-state smart|code-info|list-codes, query tx <hash>.`,
      );
  }
}

// ---------------------------------------------------------------------------
//  Per-module parsers — transactions
// ---------------------------------------------------------------------------

function parseIntent(
  positionals: string[],
  flags: Record<string, string | true>,
  memo: string,
  fees: Coin[] | undefined,
  warnings: Warning[],
): Intent {
  const [module_, action, ...rest] = positionals;

  if (!module_ || !action) {
    throw new Error("Missing module + action (expected e.g. `tx bank send …`)");
  }

  const path = `${module_} ${action}`;

  switch (path) {
    case "bank send": {
      // tx bank send <from_key_or_addr> <to_addr> <amount>
      // The wallet ignores the first positional (uses active wallet's address).
      if (rest.length < 3) {
        throw new Error("`tx bank send` expects: <from> <to> <amount>");
      }
      const [, toAddress, amountStr] = rest;
      const coin = parseSingleCoin(amountStr);
      return {
        kind: "bank.send",
        toAddress,
        amount: coin.amount,
        denom: coin.denom,
        memo,
        fees,
      };
    }

    case "wasm execute": {
      if (rest.length < 2) {
        throw new Error("`tx wasm execute` expects: <contract> <json>");
      }
      const [contract, msgRaw] = rest;
      let msg: object;
      try {
        msg = JSON.parse(msgRaw);
      } catch (e: any) {
        throw new Error(`Invalid JSON message: ${e.message}`);
      }
      const funds: Coin[] =
        typeof flags["amount"] === "string" ? parseCoinsString(flags["amount"] as string) : [];
      return {
        kind: "wasm.execute",
        contract,
        msg,
        msgRaw,
        funds,
        memo,
        fees,
      };
    }

    case "wasm instantiate":
    case "wasm instantiate2": {
      if (rest.length < 2) {
        throw new Error("`tx wasm instantiate` expects: <code-id> <init-json>");
      }
      const [codeId, initRaw] = rest;
      let initMsg: object;
      try {
        initMsg = JSON.parse(initRaw);
      } catch (e: any) {
        throw new Error(`Invalid init JSON: ${e.message}`);
      }
      const label =
        typeof flags["label"] === "string" ? (flags["label"] as string) : "";
      if (!label) throw new Error("`tx wasm instantiate` requires --label");

      const noAdmin = flags["no-admin"] === true;
      const adminFlag =
        typeof flags["admin"] === "string" ? (flags["admin"] as string) : null;
      if (!noAdmin && !adminFlag) {
        warnings.push({
          level: "info",
          message: "Neither --admin nor --no-admin specified — the wallet will instantiate without an admin.",
        });
      }
      const admin = noAdmin ? null : adminFlag;

      const funds: Coin[] =
        typeof flags["amount"] === "string"
          ? parseCoinsString(flags["amount"] as string)
          : [];
      return {
        kind: "wasm.instantiate",
        codeId,
        initMsg,
        initMsgRaw: initRaw,
        label,
        admin,
        funds,
        memo,
        fees,
      };
    }

    case "staking delegate": {
      if (rest.length < 2) {
        throw new Error("`tx staking delegate` expects: <validator> <amount>");
      }
      const [validator, amountStr] = rest;
      const coin = parseSingleCoin(amountStr);
      if (coin.denom !== GONKA_DENOM) {
        warnings.push({
          level: "error",
          message: `Staking is only supported in ${GONKA_DENOM} (got ${coin.denom}).`,
        });
      }
      return {
        kind: "staking.delegate",
        validator,
        amount: coin.amount,
        denom: coin.denom,
        memo,
        fees,
      };
    }

    case "staking unbond": {
      if (rest.length < 2) {
        throw new Error("`tx staking unbond` expects: <validator> <amount>");
      }
      const [validator, amountStr] = rest;
      const coin = parseSingleCoin(amountStr);
      if (coin.denom !== GONKA_DENOM) {
        warnings.push({
          level: "error",
          message: `Unbonding is only supported in ${GONKA_DENOM} (got ${coin.denom}).`,
        });
      }
      return {
        kind: "staking.unbond",
        validator,
        amount: coin.amount,
        denom: coin.denom,
        memo,
        fees,
      };
    }

    case "staking redelegate": {
      if (rest.length < 3) {
        throw new Error("`tx staking redelegate` expects: <src-validator> <dst-validator> <amount>");
      }
      const [src, dst, amountStr] = rest;
      const coin = parseSingleCoin(amountStr);
      if (coin.denom !== GONKA_DENOM) {
        warnings.push({
          level: "error",
          message: `Redelegation is only supported in ${GONKA_DENOM} (got ${coin.denom}).`,
        });
      }
      return {
        kind: "staking.redelegate",
        srcValidator: src,
        dstValidator: dst,
        amount: coin.amount,
        denom: coin.denom,
        memo,
        fees,
      };
    }

    case "distribution withdraw-rewards": {
      if (rest.length < 1) {
        throw new Error("`tx distribution withdraw-rewards` expects: <validator>");
      }
      return {
        kind: "distribution.withdraw-rewards",
        validator: rest[0],
        memo,
        fees,
      };
    }

    case "distribution withdraw-all-rewards": {
      return { kind: "distribution.withdraw-all-rewards", memo, fees };
    }

    case "gov vote": {
      if (rest.length < 2) {
        throw new Error("`tx gov vote` expects: <proposal-id> <option>");
      }
      const [proposalId, optionStr] = rest;
      if (!/^\d+$/.test(proposalId)) {
        throw new Error(`Proposal id must be a positive integer (got "${proposalId}")`);
      }
      return {
        kind: "gov.vote",
        proposalId,
        option: parseVoteOption(optionStr),
        memo,
        fees,
      };
    }

    case "gov deposit": {
      if (rest.length < 2) {
        throw new Error("`tx gov deposit` expects: <proposal-id> <amount>");
      }
      const [proposalId, amountStr] = rest;
      if (!/^\d+$/.test(proposalId)) {
        throw new Error(`Proposal id must be a positive integer (got "${proposalId}")`);
      }
      const coin = parseSingleCoin(amountStr);
      return {
        kind: "gov.deposit",
        proposalId,
        amount: coin.amount,
        denom: coin.denom,
        memo,
        fees,
      };
    }

    default:
      throw new Error(
        `Unsupported command: \`tx ${path}\` is not handled by GG Wallet yet. ` +
          `Supported: tx bank send, tx wasm execute|instantiate, tx staking delegate|unbond|redelegate, ` +
          `tx distribution withdraw-rewards|withdraw-all-rewards, tx gov vote|deposit.`,
      );
  }
}

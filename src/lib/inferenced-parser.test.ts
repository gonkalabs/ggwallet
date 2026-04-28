import { describe, it, expect } from "vitest";
import {
  tokenize,
  splitFlags,
  parseCoinsString,
  parseSingleCoin,
  parseVoteOption,
  parseCommand,
} from "./inferenced-parser";

// ---------------------------------------------------------------------------
//  Tokenizer
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("splits simple words on whitespace", () => {
    expect(tokenize("inferenced tx bank send")).toEqual(["inferenced", "tx", "bank", "send"]);
  });

  it("collapses runs of whitespace and tabs/newlines", () => {
    expect(tokenize("a   b\tc\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("treats single-quoted strings as one verbatim token", () => {
    expect(tokenize("--msg '{\"a\":\"b c\"}' --next 1")).toEqual([
      "--msg",
      '{"a":"b c"}',
      "--next",
      "1",
    ]);
  });

  it("treats double-quoted strings with escapes as one token", () => {
    // Note: the source string already has \" escaped to ", so the tokenizer
    // sees a literal double-quoted run here.
    expect(tokenize('--msg "hello world" --x')).toEqual(["--msg", "hello world", "--x"]);
  });

  it("supports backslash escapes inside double quotes", () => {
    // input: --msg "hi \"x\" y"   →   --msg, hi "x" y
    expect(tokenize('--msg "hi \\"x\\" y"')).toEqual(["--msg", 'hi "x" y']);
  });

  it("supports backslash escapes outside quotes", () => {
    expect(tokenize("foo\\ bar baz")).toEqual(["foo bar", "baz"]);
  });

  it("treats trailing-backslash-newline as line continuation", () => {
    const cmd = "inferenced tx bank send \\\n  gonka1abc gonka1def 100ngonka";
    expect(tokenize(cmd)).toEqual([
      "inferenced",
      "tx",
      "bank",
      "send",
      "gonka1abc",
      "gonka1def",
      "100ngonka",
    ]);
  });

  it("strips full-line comments", () => {
    expect(tokenize("# comment\nfoo bar")).toEqual(["foo", "bar"]);
  });

  it("throws on unterminated single quotes", () => {
    expect(() => tokenize("foo 'bar")).toThrow(/single quote/i);
  });

  it("throws on unterminated double quotes", () => {
    expect(() => tokenize('foo "bar')).toThrow(/double quote/i);
  });

  it("preserves the JSON arg in the canonical inferenced wasm-execute example", () => {
    const cmd =
      "./inferenced tx wasm execute gonka1contract '{\"vote\":{\"id\":\"abc\",\"amount\":\"123\"}}' --from x";
    const tokens = tokenize(cmd);
    expect(tokens[0]).toBe("./inferenced");
    expect(tokens[4]).toBe("gonka1contract");
    expect(tokens[5]).toBe('{"vote":{"id":"abc","amount":"123"}}');
    expect(tokens[6]).toBe("--from");
    expect(tokens[7]).toBe("x");
  });
});

// ---------------------------------------------------------------------------
//  Flag splitter
// ---------------------------------------------------------------------------

describe("splitFlags", () => {
  it("separates positionals from --flags", () => {
    const r = splitFlags(["bank", "send", "x", "y", "100ngonka", "--from", "alice"]);
    expect(r.positionals).toEqual(["bank", "send", "x", "y", "100ngonka"]);
    expect(r.flags).toEqual({ from: "alice" });
  });

  it("recognizes --key=value form", () => {
    const r = splitFlags(["--chain-id=gonka-mainnet"]);
    expect(r.flags).toEqual({ "chain-id": "gonka-mainnet" });
  });

  it("treats -y as a boolean flag", () => {
    const r = splitFlags(["--from", "alice", "-y"]);
    expect(r.flags).toEqual({ from: "alice", y: true });
  });

  it("treats --no-admin as a boolean", () => {
    const r = splitFlags(["--no-admin"]);
    expect(r.flags).toEqual({ "no-admin": true });
  });

  it("does not consume a flag's 'value' if it starts with -", () => {
    const r = splitFlags(["--gas", "--fees", "100ngonka"]);
    expect(r.flags).toEqual({ gas: true, fees: "100ngonka" });
  });
});

// ---------------------------------------------------------------------------
//  Coins / vote-option helpers
// ---------------------------------------------------------------------------

describe("parseCoinsString", () => {
  it("parses a single coin", () => {
    expect(parseSingleCoin("1000ngonka")).toEqual({ amount: "1000", denom: "ngonka" });
  });

  it("parses comma-separated coins", () => {
    expect(parseCoinsString("100ngonka,5uatom")).toEqual([
      { amount: "100", denom: "ngonka" },
      { amount: "5", denom: "uatom" },
    ]);
  });

  it("rejects malformed coins", () => {
    expect(() => parseSingleCoin("abc")).toThrow(/Invalid coin/);
    expect(() => parseSingleCoin("123")).toThrow(/Invalid coin/);
  });

  it("rejects non-singleton input for parseSingleCoin", () => {
    expect(() => parseSingleCoin("100ngonka,5uatom")).toThrow(/single coin/);
  });

  it("accepts ibc/ denoms", () => {
    expect(parseSingleCoin("100ibc/ABC123")).toEqual({ amount: "100", denom: "ibc/ABC123" });
  });
});

describe("parseVoteOption", () => {
  it("maps yes/no/abstain/no_with_veto", () => {
    expect(parseVoteOption("yes")).toBe("VOTE_OPTION_YES");
    expect(parseVoteOption("YES")).toBe("VOTE_OPTION_YES");
    expect(parseVoteOption("no")).toBe("VOTE_OPTION_NO");
    expect(parseVoteOption("abstain")).toBe("VOTE_OPTION_ABSTAIN");
    expect(parseVoteOption("no_with_veto")).toBe("VOTE_OPTION_NO_WITH_VETO");
    expect(parseVoteOption("no-with-veto")).toBe("VOTE_OPTION_NO_WITH_VETO");
    expect(parseVoteOption("nwv")).toBe("VOTE_OPTION_NO_WITH_VETO");
  });

  it("maps numeric option codes", () => {
    expect(parseVoteOption("1")).toBe("VOTE_OPTION_YES");
    expect(parseVoteOption("4")).toBe("VOTE_OPTION_NO_WITH_VETO");
  });

  it("rejects garbage", () => {
    expect(() => parseVoteOption("maybe")).toThrow(/Unknown vote option/);
  });
});

// ---------------------------------------------------------------------------
//  Top-level parseCommand
// ---------------------------------------------------------------------------

const CONTRACT = "gonka17htzq02230f6klt36gqspqjvv05ztevyujz0j4zxaafcqa4qylzs5hlg59";

describe("parseCommand — top-level structure", () => {
  it("rejects an empty command", () => {
    const r = parseCommand("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Empty/);
  });

  it("accepts `query …` as a separate root", () => {
    const r = parseCommand("inferenced query bank balances gonka1abc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.kind).toBe("query.bank.balances");
  });

  it("rejects unknown root commands", () => {
    const r = parseCommand("inferenced status");
    expect(r.ok).toBe(false);
  });

  it("strips a leading ./inferenced binary prefix", () => {
    const r = parseCommand(
      "./inferenced tx bank send gonka1from gonka1to 100ngonka",
    );
    expect(r.ok).toBe(true);
  });

  it("strips a bare inferenced binary prefix", () => {
    const r = parseCommand("inferenced tx bank send gonka1from gonka1to 100ngonka");
    expect(r.ok).toBe(true);
  });

  it("works without any binary prefix", () => {
    const r = parseCommand("tx bank send gonka1from gonka1to 100ngonka");
    expect(r.ok).toBe(true);
  });
});

describe("parseCommand — wasm execute (the marquee example)", () => {
  it("parses the full canonical example with --from / --chain-id / --keyring-backend / --node / -y", () => {
    const cmd = `./inferenced tx wasm execute ${CONTRACT} '{"vote":{"tender_id":"00e8a72a-e121-4ea1-8d30-95a0d51268b2","amount":"33079000000000"}}' --from <your-key> --chain-id gonka-mainnet --keyring-backend file --node http://node1.gonka.ai:8000/chain-rpc/ -y`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.kind).toBe("wasm.execute");
    if (r.intent.kind !== "wasm.execute") return;
    expect(r.intent.contract).toBe(CONTRACT);
    expect(r.intent.msg).toEqual({
      vote: {
        tender_id: "00e8a72a-e121-4ea1-8d30-95a0d51268b2",
        amount: "33079000000000",
      },
    });
    expect(r.intent.funds).toEqual([]);
  });

  it("emits an info warning for --node and the placeholder --from", () => {
    const cmd = `inferenced tx wasm execute ${CONTRACT} '{"a":1}' --from <your-key> --chain-id gonka-mainnet --node http://node1.gonka.ai:8000/chain-rpc/`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const messages = r.warnings.map((w) => w.message);
    expect(messages.some((m) => m.includes("--node"))).toBe(true);
    // `<your-key>` is a placeholder — should NOT trigger a `--from` warning.
    expect(messages.some((m) => m.includes("--from"))).toBe(false);
  });

  it("warns about --from when the value is a real-looking name (not a placeholder)", () => {
    const cmd = `inferenced tx wasm execute ${CONTRACT} '{"a":1}' --from alice --chain-id gonka-mainnet`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.message.includes("--from"))).toBe(true);
  });

  it("blocks execution when --chain-id mismatches the wallet chain", () => {
    const cmd = `inferenced tx wasm execute ${CONTRACT} '{"a":1}' --chain-id cosmoshub-4 -y`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/chain/i);
    expect(r.warnings.some((w) => w.level === "error")).toBe(true);
  });

  it("flags malformed JSON message", () => {
    const cmd = `tx wasm execute ${CONTRACT} '{not_json}'`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/JSON/i);
  });

  it("accepts --amount as funds", () => {
    const cmd = `tx wasm execute ${CONTRACT} '{"a":1}' --amount 5000000ngonka`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "wasm.execute") return;
    expect(r.intent.funds).toEqual([{ amount: "5000000", denom: "ngonka" }]);
  });
});

describe("parseCommand — bank send", () => {
  it("parses positional args and the amount coin", () => {
    const r = parseCommand("tx bank send gonka1from gonka1to 100ngonka");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "bank.send") return;
    expect(r.intent.toAddress).toBe("gonka1to");
    expect(r.intent.amount).toBe("100");
    expect(r.intent.denom).toBe("ngonka");
  });

  it("requires three positional args", () => {
    const r = parseCommand("tx bank send gonka1from gonka1to");
    expect(r.ok).toBe(false);
  });
});

describe("parseCommand — staking", () => {
  it("parses delegate", () => {
    const r = parseCommand("tx staking delegate gonkavaloper1abc 1000ngonka");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "staking.delegate") return;
    expect(r.intent.validator).toBe("gonkavaloper1abc");
    expect(r.intent.amount).toBe("1000");
  });

  it("parses unbond", () => {
    const r = parseCommand("tx staking unbond gonkavaloper1abc 1000ngonka");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.kind).toBe("staking.unbond");
  });

  it("parses redelegate", () => {
    const r = parseCommand("tx staking redelegate gonkavaloper1src gonkavaloper1dst 500ngonka");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "staking.redelegate") return;
    expect(r.intent.srcValidator).toBe("gonkavaloper1src");
    expect(r.intent.dstValidator).toBe("gonkavaloper1dst");
  });

  it("rejects staking in non-ngonka denom", () => {
    const r = parseCommand("tx staking delegate gonkavaloper1abc 1000uatom");
    expect(r.ok).toBe(false);
  });
});

describe("parseCommand — gov", () => {
  it("parses vote with text option", () => {
    const r = parseCommand("tx gov vote 7 yes --chain-id gonka-mainnet -y");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "gov.vote") return;
    expect(r.intent.proposalId).toBe("7");
    expect(r.intent.option).toBe("VOTE_OPTION_YES");
  });

  it("rejects non-numeric proposal id", () => {
    const r = parseCommand("tx gov vote abc yes");
    expect(r.ok).toBe(false);
  });

  it("parses deposit", () => {
    const r = parseCommand("tx gov deposit 7 1000ngonka");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "gov.deposit") return;
    expect(r.intent.proposalId).toBe("7");
    expect(r.intent.amount).toBe("1000");
  });
});

describe("parseCommand — distribution", () => {
  it("parses withdraw-rewards", () => {
    const r = parseCommand("tx distribution withdraw-rewards gonkavaloper1abc");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "distribution.withdraw-rewards") return;
    expect(r.intent.validator).toBe("gonkavaloper1abc");
  });

  it("parses withdraw-all-rewards", () => {
    const r = parseCommand("tx distribution withdraw-all-rewards");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.kind).toBe("distribution.withdraw-all-rewards");
  });
});

describe("parseCommand — wasm instantiate", () => {
  it("requires --label", () => {
    const r = parseCommand("tx wasm instantiate 5 '{\"a\":1}' --no-admin");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/--label/);
  });

  it("parses with --label and --admin", () => {
    const r = parseCommand(
      "tx wasm instantiate 5 '{\"a\":1}' --label myc --admin gonka1adm",
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "wasm.instantiate") return;
    expect(r.intent.codeId).toBe("5");
    expect(r.intent.label).toBe("myc");
    expect(r.intent.admin).toBe("gonka1adm");
  });

  it("parses with --no-admin", () => {
    const r = parseCommand(
      "tx wasm instantiate 5 '{\"a\":1}' --label myc --no-admin",
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "wasm.instantiate") return;
    expect(r.intent.admin).toBeNull();
  });
});

// ---------------------------------------------------------------------------
//  Queries
// ---------------------------------------------------------------------------

describe("parseCommand — query wasm contract-state smart (the screenshot case)", () => {
  it("parses the exact command from the user's screenshot", () => {
    const cmd =
      `inferenced query wasm contract-state smart ` +
      `gonka1rd582xazhyxde68g099ed0zpjzq0j0shnhkegg06s8009h7lnxjqvyf0qf ` +
      `'{"is_available":{"name":"<yourname>"}}' --node https://gonka.gg/chain-rpc/`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.kind).toBe("query.wasm.smart");
    if (r.intent.kind !== "query.wasm.smart") return;
    expect(r.intent.contract).toBe(
      "gonka1rd582xazhyxde68g099ed0zpjzq0j0shnhkegg06s8009h7lnxjqvyf0qf",
    );
    expect(r.intent.query).toEqual({ is_available: { name: "<yourname>" } });
    // --node should produce an info warning, never block the run
    expect(r.warnings.some((w) => w.message.includes("--node"))).toBe(true);
    expect(r.warnings.every((w) => w.level === "info")).toBe(true);
  });

  it("does NOT block a query when --chain-id mismatches (only warns)", () => {
    const cmd = `query wasm contract-state smart gonka1abc '{"a":1}' --chain-id cosmoshub-4`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.message.includes("chain"))).toBe(true);
    expect(r.warnings.every((w) => w.level === "info")).toBe(true);
  });

  it("rejects malformed query JSON", () => {
    const cmd = `query wasm contract-state smart gonka1abc '{not_json}'`;
    const r = parseCommand(cmd);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/JSON/i);
  });
});

describe("parseCommand — query bank / staking / distribution / gov / auth / tx / wasm", () => {
  it("parses bank balances", () => {
    const r = parseCommand("query bank balances gonka1abc");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "query.bank.balances") return;
    expect(r.intent.address).toBe("gonka1abc");
  });

  it("parses bank balance with two positionals", () => {
    const r = parseCommand("query bank balance gonka1abc ngonka");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "query.bank.balance") return;
    expect(r.intent.address).toBe("gonka1abc");
    expect(r.intent.denom).toBe("ngonka");
  });

  it("parses bank balance with --denom flag", () => {
    const r = parseCommand("query bank balance gonka1abc --denom ngonka");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "query.bank.balance") return;
    expect(r.intent.denom).toBe("ngonka");
  });

  it("falls back to wallet address when 'me' is used", () => {
    const r = parseCommand("query bank balances me", "gonka1self");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "query.bank.balances") return;
    expect(r.intent.address).toBe("gonka1self");
  });

  it("parses staking delegations + delegation + validator + validators", () => {
    const a = parseCommand("query staking delegations gonka1abc");
    expect(a.ok && a.intent.kind === "query.staking.delegations").toBe(true);
    const b = parseCommand("query staking delegation gonka1abc gonkavaloper1xyz");
    expect(b.ok && b.intent.kind === "query.staking.delegation").toBe(true);
    const c = parseCommand("query staking validator gonkavaloper1xyz");
    expect(c.ok && c.intent.kind === "query.staking.validator").toBe(true);
    const d = parseCommand("query staking validators");
    expect(d.ok && d.intent.kind === "query.staking.validators").toBe(true);
  });

  it("parses distribution rewards (delegator + per-validator)", () => {
    const a = parseCommand("query distribution rewards gonka1abc");
    expect(a.ok && a.intent.kind === "query.distribution.rewards").toBe(true);
    const b = parseCommand("query distribution rewards gonka1abc gonkavaloper1xyz");
    expect(b.ok && b.intent.kind === "query.distribution.rewards-from-validator").toBe(true);
  });

  it("parses gov proposal / proposals / tally", () => {
    const a = parseCommand("query gov proposal 7");
    expect(a.ok && a.intent.kind === "query.gov.proposal").toBe(true);
    const b = parseCommand("query gov proposals");
    expect(b.ok && b.intent.kind === "query.gov.proposals").toBe(true);
    const c = parseCommand("query gov tally 7");
    expect(c.ok && c.intent.kind === "query.gov.tally").toBe(true);
  });

  it("parses auth account", () => {
    const r = parseCommand("query auth account gonka1abc");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "query.auth.account") return;
    expect(r.intent.address).toBe("gonka1abc");
  });

  it("parses tx <hash>", () => {
    const r = parseCommand("query tx ABC123");
    expect(r.ok).toBe(true);
    if (!r.ok || r.intent.kind !== "query.tx") return;
    expect(r.intent.hash).toBe("ABC123");
  });

  it("parses wasm code-info and list-codes", () => {
    const a = parseCommand("query wasm code-info 5");
    expect(a.ok && a.intent.kind === "query.wasm.code-info").toBe(true);
    const b = parseCommand("query wasm list-codes");
    expect(b.ok && b.intent.kind === "query.wasm.list-codes").toBe(true);
    const c = parseCommand("query wasm list-code");
    expect(c.ok && c.intent.kind === "query.wasm.list-codes").toBe(true);
  });

  it("rejects `query unknown thing`", () => {
    const r = parseCommand("query nosuchmodule action");
    expect(r.ok).toBe(false);
  });
});

describe("parseCommand — unsupported subcommands", () => {
  it("returns a useful message for `tx wasm store`", () => {
    const r = parseCommand("tx wasm store ./contract.wasm --label foo");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Unsupported|not handled/i);
  });

  it("returns a useful message for `tx ibc-transfer transfer`", () => {
    const r = parseCommand("tx ibc-transfer transfer transfer channel-0 gonka1to 100ngonka");
    expect(r.ok).toBe(false);
  });

  it("returns a useful message for `tx authz exec`", () => {
    const r = parseCommand("tx authz exec ./tx.json");
    expect(r.ok).toBe(false);
  });
});

/**
 * Gonka blockchain configuration constants.
 * Source: https://github.com/chainapsis/keplr-chain-registry/blob/main/cosmos/gonka-mainnet.json
 */

export const GONKA_CHAIN_ID = "gonka-mainnet";
export const GONKA_CHAIN_NAME = "Gonka";

export const GONKA_COIN_TYPE = 1200;
export const GONKA_HD_PATH = "m/44'/1200'/0'/0/0";

export const GONKA_BECH32_PREFIX = "gonka";

export const GONKA_DENOM = "ngonka";
export const GONKA_DISPLAY_DENOM = "GNK";
export const GONKA_DECIMALS = 9;

export const GONKA_BECH32_CONFIG = {
  bech32PrefixAccAddr: "gonka",
  bech32PrefixAccPub: "gonkapub",
  bech32PrefixValAddr: "gonkavaloper",
  bech32PrefixValPub: "gonkavaloperpub",
  bech32PrefixConsAddr: "gonkavalcons",
  bech32PrefixConsPub: "gonkavalconspub",
} as const;

export const GONKA_GAS_PRICE = "0ngonka";

export const GONKA_EXPLORER_URL = "https://gonka.gg";
export const GONKA_EXPLORER_API_KEY = "gnk_live_VhYzuMO2cSQDq-WkNnQQzDl5DF5hxaQc3pwXtWisKsc";

// Gonka Name Service (.gnk) — set after deployment
export const GNS_CONTRACT_ADDRESS = "gonka1rd582xazhyxde68g099ed0zpjzq0j0shnhkegg06s8009h7lnxjqvyf0qf";
export const GNS_SUFFIX = ".gnk";

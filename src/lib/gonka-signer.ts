/**
 * TypeScript port of opengnk/internal/signer/signer.go
 *
 * Produces ECDSA-SHA256 signatures over secp256k1, matching the
 * official gonka-openai Python SDK v0.2.4 signing scheme exactly.
 *
 * Signing scheme:
 *   1. payload_hash = hex(SHA256(payload_bytes))
 *   2. signature_input = payload_hash + str(timestamp_ns) + transfer_address
 *   3. Sign SHA256(signature_input) with deterministic ECDSA (RFC 6979), low-S normalised
 *   4. Encode r(32 bytes) || s(32 bytes) as base64
 */

import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";

// secp256k1 curve parameters
const CURVE_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const HALF_ORDER = CURVE_ORDER >> 1n;
const P = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F");
const Gx = BigInt("0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798");
const Gy = BigInt("0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8");

/**
 * Sign a payload for the Gonka inference network.
 *
 * @param privateKeyHex - hex-encoded secp256k1 private key (64 chars, no 0x prefix)
 * @param payload - raw payload bytes (will be SHA256-hashed)
 * @param transferAddress - bech32 gonka address
 * @returns { signature: base64 string, timestampNs: bigint }
 */
export function sign(
  privateKeyHex: string,
  payload: Uint8Array,
  transferAddress: string
): { signature: string; timestampNs: bigint } {
  const privKey = hexToBytes(privateKeyHex.replace(/^0x/, ""));
  if (privKey.length !== 32) {
    throw new Error(`Private key must be 32 bytes, got ${privKey.length}`);
  }

  const D = bytesToBigInt(privKey);
  const timestampNs = BigInt(Date.now()) * 1_000_000n; // ms -> ns

  // Step 1: SHA256 hash of payload, then hex encode
  const payloadHash = Uint8Array.from(sha256(payload));
  const payloadHex = bytesToHex(payloadHash);

  // Step 2: Build signature input string
  const sigInput = payloadHex + timestampNs.toString() + transferAddress;

  // Step 3: SHA256 of signature input
  const msgHash = Uint8Array.from(sha256(new TextEncoder().encode(sigInput)));

  // Step 4: Deterministic ECDSA sign (RFC 6979)
  let { r, s } = rfc6979Sign(D, msgHash);

  // Low-S normalisation
  if (s > HALF_ORDER) {
    s = CURVE_ORDER - s;
  }

  // Step 5: Encode r||s as 64 bytes, base64
  const out = new Uint8Array(64);
  const rBytes = bigIntToBytes32(r);
  const sBytes = bigIntToBytes32(s);
  out.set(rBytes, 0);
  out.set(sBytes, 32);

  return {
    signature: uint8ToBase64(out),
    timestampNs,
  };
}

// ---- secp256k1 point arithmetic (affine) ----

interface Point {
  x: bigint;
  y: bigint;
}

const POINT_AT_INFINITY: Point = { x: 0n, y: 0n };
const G: Point = { x: Gx, y: Gy };

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

function modInverse(a: bigint, m: bigint): bigint {
  // Extended Euclidean algorithm
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s, m);
}

function pointAdd(p1: Point, p2: Point): Point {
  if (p1.x === 0n && p1.y === 0n) return p2;
  if (p2.x === 0n && p2.y === 0n) return p1;

  if (p1.x === p2.x && p1.y !== p2.y) return POINT_AT_INFINITY;

  let lam: bigint;
  if (p1.x === p2.x && p1.y === p2.y) {
    // Point doubling
    lam = mod(3n * p1.x * p1.x * modInverse(2n * p1.y, P), P);
  } else {
    lam = mod((p2.y - p1.y) * modInverse(p2.x - p1.x, P), P);
  }

  const x3 = mod(lam * lam - p1.x - p2.x, P);
  const y3 = mod(lam * (p1.x - x3) - p1.y, P);
  return { x: x3, y: y3 };
}

function scalarMult(k: bigint, point: Point): Point {
  let result = POINT_AT_INFINITY;
  let addend = point;
  let n = k;
  while (n > 0n) {
    if (n & 1n) {
      result = pointAdd(result, addend);
    }
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}

// ---- RFC 6979 deterministic ECDSA ----

function rfc6979Sign(D: bigint, hash: Uint8Array): { r: bigint; s: bigint } {
  const N = CURVE_ORDER;
  const qlen = 256; // bit length of N
  const holen = 32; // SHA-256 output

  const bx = int2octets(D, qlen);
  const bh = bits2octets(hash, N, qlen);

  // Step b: V = 0x01 repeated
  let v: Uint8Array = new Uint8Array(holen);
  v.fill(0x01);

  // Step c: K = 0x00 repeated
  let kk: Uint8Array = new Uint8Array(holen);

  // Step d: K = HMAC_K(V || 0x00 || int2octets(x) || bits2octets(h1))
  kk = Uint8Array.from(hmac(sha256, kk, concatBytes(v, new Uint8Array([0x00]), bx, bh)));

  // Step e: V = HMAC_K(V)
  v = Uint8Array.from(hmac(sha256, kk, v));

  // Step f: K = HMAC_K(V || 0x01 || int2octets(x) || bits2octets(h1))
  kk = Uint8Array.from(hmac(sha256, kk, concatBytes(v, new Uint8Array([0x01]), bx, bh)));

  // Step g: V = HMAC_K(V)
  v = Uint8Array.from(hmac(sha256, kk, v));

  // Step h: Generate k
  while (true) {
    let t: Uint8Array = new Uint8Array(0);
    while (t.length * 8 < qlen) {
      v = Uint8Array.from(hmac(sha256, kk, v));
      t = concatBytes(t, v);
    }

    const secret = bits2int(t, qlen);
    if (secret > 0n && secret < N) {
      // Compute signature with this k
      const point = scalarMult(secret, G);
      const r = mod(point.x, N);
      if (r === 0n) continue;

      const kInv = modInverse(secret, N);
      const e = bytesToBigInt(hash);
      const s = mod(kInv * (e + r * D), N);
      if (s === 0n) continue;

      return { r, s };
    }

    // k unsuitable, try again
    kk = Uint8Array.from(hmac(sha256, kk, concatBytes(v, new Uint8Array([0x00]))));
    v = Uint8Array.from(hmac(sha256, kk, v));
  }
}

// ---- RFC 6979 helper functions (matching Go implementation) ----

function int2octets(v: bigint, qlen: number): Uint8Array {
  const rlen = Math.ceil(qlen / 8);
  const out = bigIntToBytes(v);
  if (out.length >= rlen) {
    return out.slice(out.length - rlen);
  }
  const padded = new Uint8Array(rlen);
  padded.set(out, rlen - out.length);
  return padded;
}

function bits2int(b: Uint8Array, qlen: number): bigint {
  let v = bytesToBigInt(b);
  const blen = b.length * 8;
  if (blen > qlen) {
    v >>= BigInt(blen - qlen);
  }
  return v;
}

function bits2octets(b: Uint8Array, q: bigint, qlen: number): Uint8Array {
  const z1 = bits2int(b, qlen);
  let z2 = z1 - q;
  if (z2 < 0n) {
    z2 = z1;
  }
  return int2octets(z2, qlen);
}

// ---- Byte/BigInt conversion utilities ----

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function bigIntToBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0]);
  const hex = n.toString(16);
  const paddedHex = hex.length % 2 ? "0" + hex : hex;
  return hexToBytes(paddedHex);
}

function bigIntToBytes32(n: bigint): Uint8Array {
  const bytes = bigIntToBytes(n);
  if (bytes.length >= 32) return bytes.slice(bytes.length - 32);
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return padded;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function uint8ToBase64(buf: Uint8Array): string {
  let binary = "";
  for (const byte of buf) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

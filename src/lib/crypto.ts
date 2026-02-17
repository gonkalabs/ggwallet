/**
 * AES-GCM encryption/decryption for mnemonic storage.
 * Uses PBKDF2 to derive an encryption key from the user's password.
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/**
 * Derive an AES-GCM key from a password using PBKDF2.
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a plaintext string with AES-GCM.
 * Returns { ciphertext, salt, iv } as base64 strings.
 */
export async function encrypt(
  plaintext: string,
  password: string
): Promise<{ ciphertext: string; salt: string; iv: string }> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );

  return {
    ciphertext: bufToBase64(new Uint8Array(cipherBuffer)),
    salt: bufToBase64(salt),
    iv: bufToBase64(iv),
  };
}

/**
 * Decrypt a ciphertext with AES-GCM.
 * Returns the decrypted plaintext string.
 * Throws if password is wrong.
 */
export async function decrypt(
  ciphertext: string,
  salt: string,
  iv: string,
  password: string
): Promise<string> {
  const key = await deriveKey(password, base64ToBuf(salt));
  const dec = new TextDecoder();

  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBuf(iv) as BufferSource },
    key,
    base64ToBuf(ciphertext) as BufferSource
  );

  return dec.decode(plainBuffer);
}

// ---- Helpers ----

function bufToBase64(buf: Uint8Array): string {
  let binary = "";
  for (const byte of buf) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}

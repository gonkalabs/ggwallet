import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto";

describe("crypto – AES-GCM encrypt/decrypt", () => {
  const password = "test-password-123";
  const plaintext = "abandon badge camera donate elephant fabric";

  it("encrypts and decrypts back to the original plaintext", async () => {
    const { ciphertext, salt, iv } = await encrypt(plaintext, password);
    const result = await decrypt(ciphertext, salt, iv, password);
    expect(result).toBe(plaintext);
  });

  it("produces different ciphertext on each call (random salt/iv)", async () => {
    const a = await encrypt(plaintext, password);
    const b = await encrypt(plaintext, password);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  it("fails to decrypt with the wrong password", async () => {
    const { ciphertext, salt, iv } = await encrypt(plaintext, password);
    await expect(decrypt(ciphertext, salt, iv, "wrong-password")).rejects.toThrow();
  });

  it("handles empty string plaintext", async () => {
    const { ciphertext, salt, iv } = await encrypt("", password);
    const result = await decrypt(ciphertext, salt, iv, password);
    expect(result).toBe("");
  });

  it("handles unicode plaintext", async () => {
    const unicode = "钱包测试 🔐 кошелек";
    const { ciphertext, salt, iv } = await encrypt(unicode, password);
    const result = await decrypt(ciphertext, salt, iv, password);
    expect(result).toBe(unicode);
  });
});

/**
 * End-to-end encryption for Annotino.
 *
 * Nothing readable ever leaves the browser:
 *  - The login password is never sent to the server. We derive two independent
 *    secrets from it: an "auth secret" (sent to the auth provider in place of the
 *    password) and a key-encryption key (KEK) that never leaves the device.
 *  - Every user owns an RSA-OAEP key pair. The private key is stored on the server
 *    only wrapped with the KEK (and, separately, with a one-time recovery code).
 *  - Every team owns a random AES-256-GCM key. It is stored once per member,
 *    wrapped with that member's public key.
 *  - Audio, file names, team names and annotations are encrypted with the team key.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

const AUTH_ITERATIONS = 210_000;
const KEK_ITERATIONS = 600_000;
const RECOVERY_ITERATIONS = 210_000;

// ---------- encoding helpers ----------

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

const BASE32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A human-transcribable recovery code, e.g. "K7QH-M2PX-…" (100 bits). */
export function newRecoveryCode(): string {
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (b) => BASE32[b % 32]);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(''));
  return groups.join('-');
}

export function normaliseRecoveryCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (clean.match(/.{1,4}/g) ?? []).join('-');
}

// ---------- key derivation ----------

async function pbkdf2Bits(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
}

/** Secret sent to the auth provider instead of the real password. */
export async function deriveAuthSecret(email: string, password: string): Promise<string> {
  const salt = enc.encode(`annotino/auth/v1/${email.trim().toLowerCase()}`);
  const bits = await pbkdf2Bits(password, salt, AUTH_ITERATIONS);
  return toB64(bits).replace(/=+$/, '');
}

async function deriveWrappingKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const bits = await pbkdf2Bits(`annotino/kek/v1/${secret}`, salt, iterations);
  return subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// ---------- symmetric encryption ----------

export async function encryptBytes(key: CryptoKey, data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key: CryptoKey, data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, key, u8.subarray(12));
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<string> {
  return toB64(await encryptBytes(key, enc.encode(JSON.stringify(value))));
}

export async function decryptJSON<T>(key: CryptoKey, b64: string): Promise<T> {
  return JSON.parse(dec.decode(await decryptBytes(key, fromB64(b64)))) as T;
}

// ---------- user key pair ----------

const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;

export interface UserKeyMaterial {
  publicKey: JsonWebKey;
  encPrivateKey: string;
  kdfSalt: string;
  recoveryPrivateKey: string;
  recoverySalt: string;
}

export async function createUserKeys(password: string): Promise<{ material: UserKeyMaterial; recoveryCode: string; privateKey: CryptoKey }> {
  const pair = await subtle.generateKey(
    { ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['encrypt', 'decrypt'],
  );
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
  const publicKey = await subtle.exportKey('jwk', pair.publicKey);

  const kdfSalt = randomBytes(16);
  const kek = await deriveWrappingKey(password, kdfSalt, KEK_ITERATIONS);
  const recoveryCode = newRecoveryCode();
  const recoverySalt = randomBytes(16);
  const rek = await deriveWrappingKey(recoveryCode, recoverySalt, RECOVERY_ITERATIONS);

  const material: UserKeyMaterial = {
    publicKey,
    encPrivateKey: toB64(await encryptBytes(kek, pkcs8)),
    kdfSalt: toB64(kdfSalt),
    recoveryPrivateKey: toB64(await encryptBytes(rek, pkcs8)),
    recoverySalt: toB64(recoverySalt),
  };
  return { material, recoveryCode, privateKey: await importPrivate(pkcs8) };
}

function importPrivate(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  // Non-extractable: once unlocked, the key can be used but never read back.
  return subtle.importKey('pkcs8', pkcs8, RSA, false, ['decrypt']);
}

export async function unlockPrivateKey(material: Pick<UserKeyMaterial, 'encPrivateKey' | 'kdfSalt'>, password: string): Promise<CryptoKey> {
  const kek = await deriveWrappingKey(password, fromB64(material.kdfSalt), KEK_ITERATIONS);
  return importPrivate(await decryptBytes(kek, fromB64(material.encPrivateKey)));
}

/** Unlock with the recovery code and re-wrap the private key under a new password. */
export async function recoverPrivateKey(
  material: UserKeyMaterial,
  recoveryCode: string,
  newPassword: string,
): Promise<{ privateKey: CryptoKey; encPrivateKey: string; kdfSalt: string }> {
  const rek = await deriveWrappingKey(normaliseRecoveryCode(recoveryCode), fromB64(material.recoverySalt), RECOVERY_ITERATIONS);
  const pkcs8 = await decryptBytes(rek, fromB64(material.recoveryPrivateKey));
  const kdfSalt = randomBytes(16);
  const kek = await deriveWrappingKey(newPassword, kdfSalt, KEK_ITERATIONS);
  return {
    privateKey: await importPrivate(pkcs8),
    encPrivateKey: toB64(await encryptBytes(kek, pkcs8)),
    kdfSalt: toB64(kdfSalt),
  };
}

/** Re-wrap the private key under a new password (requires the current one). */
export async function rewrapPrivateKey(
  material: UserKeyMaterial,
  oldPassword: string,
  newPassword: string,
): Promise<{ encPrivateKey: string; kdfSalt: string }> {
  const kek = await deriveWrappingKey(oldPassword, fromB64(material.kdfSalt), KEK_ITERATIONS);
  const pkcs8 = await decryptBytes(kek, fromB64(material.encPrivateKey));
  const kdfSalt = randomBytes(16);
  const newKek = await deriveWrappingKey(newPassword, kdfSalt, KEK_ITERATIONS);
  return { encPrivateKey: toB64(await encryptBytes(newKek, pkcs8)), kdfSalt: toB64(kdfSalt) };
}

/** Short, comparable fingerprint of a public key, for verifying a teammate out of band. */
export async function fingerprint(publicKey: JsonWebKey): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', enc.encode(`${publicKey.n}.${publicKey.e}`)));
  return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .match(/.{4}/g)!
    .join(' ');
}

// ---------- team keys ----------

export async function newTeamKey(): Promise<{ key: CryptoKey; raw: ArrayBuffer }> {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await subtle.exportKey('raw', key);
  return { key: await importTeamKey(raw), raw };
}

function importTeamKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function wrapTeamKey(raw: ArrayBuffer, memberPublicKey: JsonWebKey): Promise<string> {
  const pub = await subtle.importKey('jwk', memberPublicKey, RSA, false, ['encrypt']);
  return toB64(await subtle.encrypt(RSA, pub, raw));
}

export async function unwrapTeamKey(wrapped: string, privateKey: CryptoKey): Promise<{ key: CryptoKey; raw: ArrayBuffer }> {
  const raw = await subtle.decrypt(RSA, privateKey, fromB64(wrapped));
  return { key: await importTeamKey(raw), raw };
}

import { backend, githubBackend, setMode } from '../backend';
import type { ProfileRow, Session } from '../backend/types';
import {
  createUserKeys,
  deriveAuthSecret,
  recoverPrivateKey,
  rewrapPrivateKey,
  unlockPrivateKey,
} from '../crypto/crypto';
import { deviceKeys } from '../lib/idb';
import type { GitHubTokens } from '../backend/githubAuth';

export interface Identity {
  session: Session;
  profile: ProfileRow;
  privateKey: CryptoKey;
}

/** Give the backend what it needs to seal and open private annotations (GitHub mode). */
function ready(identity: Identity): Identity {
  backend.setIdentity?.(identity.privateKey, identity.profile.public_key);
  return identity;
}

export type SignInResult =
  | { status: 'ready'; identity: Identity }
  | { status: 'needs-keys'; session: Session };

export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (backend.kind === 'github') throw new Error('Sign in with a GitHub token.');
  const secret = await deriveAuthSecret(email, password);
  const session = await backend.signIn(email, secret);
  const profile = await backend.getMyProfile();
  if (!profile) return { status: 'needs-keys', session };
  let privateKey: CryptoKey;
  try {
    privateKey = await unlockPrivateKey({ encPrivateKey: profile.enc_private_key, kdfSalt: profile.kdf_salt }, password);
  } catch {
    throw new Error('Your encryption key could not be unlocked with this password.');
  }
  await deviceKeys.put(session.userId, privateKey);
  return { status: 'ready', identity: ready({ session, profile, privateKey }) };
}

/** GitHub mode: the token identifies the user; the password protects the key in their profile gist. */
export async function signInWithGitHub(token: string | GitHubTokens | null, password: string): Promise<SignInResult> {
  setMode('github');
  // null: already connected through the GitHub App (the tokens may have been renewed since).
  const session = token ? await githubBackend().connect(token) : await backend.session();
  if (!session) throw new Error('Your GitHub session has ended. Sign in with GitHub again.');
  const profile = await backend.getMyProfile();
  if (!profile) return { status: 'needs-keys', session };
  let privateKey: CryptoKey;
  try {
    privateKey = await unlockPrivateKey({ encPrivateKey: profile.enc_private_key, kdfSalt: profile.kdf_salt }, password);
  } catch {
    throw new Error('Your encryption key could not be unlocked with this password.');
  }
  await deviceKeys.put(session.userId, privateKey);
  return { status: 'ready', identity: ready({ session, profile, privateKey }) };
}

export async function signUp(email: string, password: string): Promise<SignInResult | { status: 'confirm-email' }> {
  const secret = await deriveAuthSecret(email, password);
  const session = await backend.signUp(email, secret);
  if (!session) return { status: 'confirm-email' };
  return { status: 'needs-keys', session };
}

/** First sign-in: create the key pair and the profile. Returns the recovery code to show once. */
export async function createKeys(session: Session, password: string, displayName: string): Promise<{ identity: Identity; recoveryCode: string }> {
  const { material, recoveryCode, privateKey } = await createUserKeys(password);
  const profile: ProfileRow = {
    id: session.userId,
    email: session.email.toLowerCase(),
    display_name: displayName.trim(),
    public_key: material.publicKey,
    enc_private_key: material.encPrivateKey,
    kdf_salt: material.kdfSalt,
    recovery_private_key: material.recoveryPrivateKey,
    recovery_salt: material.recoverySalt,
  };
  await backend.saveMyProfile(profile);
  await deviceKeys.put(session.userId, privateKey);
  return { identity: ready({ session, profile, privateKey }), recoveryCode };
}

/** Restore a previous session on this device, if its key is still stored here. */
export async function restore(): Promise<Identity | { session: Session; profile: ProfileRow | null } | null> {
  const session = await backend.session();
  if (!session) return null;
  const profile = await backend.getMyProfile();
  const privateKey = await deviceKeys.get<CryptoKey>(session.userId);
  if (profile && privateKey) return ready({ session, profile, privateKey });
  return { session, profile };
}

export async function unlock(session: Session, profile: ProfileRow, password: string): Promise<Identity> {
  const privateKey = await unlockPrivateKey({ encPrivateKey: profile.enc_private_key, kdfSalt: profile.kdf_salt }, password);
  await deviceKeys.put(session.userId, privateKey);
  return ready({ session, profile, privateKey });
}

/** Use the recovery code to regain the key, then set a new password. */
export async function recover(session: Session, profile: ProfileRow, code: string, newPassword: string): Promise<Identity> {
  let result;
  try {
    result = await recoverPrivateKey(
      {
        publicKey: profile.public_key,
        encPrivateKey: profile.enc_private_key,
        kdfSalt: profile.kdf_salt,
        recoveryPrivateKey: profile.recovery_private_key,
        recoverySalt: profile.recovery_salt,
      },
      code,
      newPassword,
    );
  } catch {
    throw new Error('This recovery code does not match your account.');
  }
  const updated: ProfileRow = { ...profile, enc_private_key: result.encPrivateKey, kdf_salt: result.kdfSalt };
  await backend.saveMyProfile(updated);
  await backend.changeAuthSecret(await deriveAuthSecret(session.email, newPassword));
  await deviceKeys.put(session.userId, result.privateKey);
  return ready({ session, profile: updated, privateKey: result.privateKey });
}

export async function changePassword(identity: Identity, oldPassword: string, newPassword: string): Promise<Identity> {
  const p = identity.profile;
  let wrapped;
  try {
    wrapped = await rewrapPrivateKey(
      {
        publicKey: p.public_key,
        encPrivateKey: p.enc_private_key,
        kdfSalt: p.kdf_salt,
        recoveryPrivateKey: p.recovery_private_key,
        recoverySalt: p.recovery_salt,
      },
      oldPassword,
      newPassword,
    );
  } catch {
    throw new Error('The current password is incorrect.');
  }
  const updated: ProfileRow = { ...p, enc_private_key: wrapped.encPrivateKey, kdf_salt: wrapped.kdfSalt };
  await backend.saveMyProfile(updated);
  await backend.changeAuthSecret(await deriveAuthSecret(identity.session.email, newPassword));
  return { ...identity, profile: updated };
}

export async function signOut(userId?: string) {
  if (userId) await deviceKeys.delete(userId);
  await backend.signOut();
}

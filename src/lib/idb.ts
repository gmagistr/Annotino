/** Minimal promise wrapper around IndexedDB: one database, several object stores. */

export function openDB(name: string, stores: string[], version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      for (const s of stores) {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      }
    };
    req.onsuccess = () => {
      // Let a newer version of Annotino (in another tab) upgrade the database.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class Store {
  constructor(private db: Promise<IDBDatabase>, private name: string) {}

  private async tx(mode: IDBTransactionMode) {
    return (await this.db).transaction(this.name, mode).objectStore(this.name);
  }
  async get<T>(key: string): Promise<T | undefined> {
    return wrap((await this.tx('readonly')).get(key)) as Promise<T | undefined>;
  }
  async put(key: string, value: unknown): Promise<void> {
    await wrap((await this.tx('readwrite')).put(value, key));
  }
  async delete(key: string): Promise<void> {
    await wrap((await this.tx('readwrite')).delete(key));
  }
  async all<T>(): Promise<T[]> {
    return wrap((await this.tx('readonly')).getAll()) as Promise<T[]>;
  }
}

const deviceDB = openDB('annotino-device', ['keys', 'prefs', 'blobs'], 2);
/** Unlocked (non-extractable) private keys, kept on this device until sign-out. */
export const deviceKeys = new Store(deviceDB, 'keys');
export const devicePrefs = new Store(deviceDB, 'prefs');
/** Content-addressed copies of GitHub blobs (ciphertext), so files are downloaded once. */
export const blobCache = new Store(deviceDB, 'blobs');

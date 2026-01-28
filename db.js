// db.js (ESM)
const DB_NAME = "btx_prontuario_pwa";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("patients")) {
        const s = db.createObjectStore("patients", { keyPath: "id" });
        s.createIndex("by_name", "name", { unique: false });
      }

      if (!db.objectStoreNames.contains("appointments")) {
        const s = db.createObjectStore("appointments", { keyPath: "id" });
        s.createIndex("by_date", "date", { unique: false });
        s.createIndex("by_patient", "patientId", { unique: false });
      }

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

function id() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const s = tx(db, store, "readwrite");
    const req = s.put(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const s = tx(db, store);
    const req = s.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const s = tx(db, store, "readwrite");
    const req = s.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const s = tx(db, store);
    const req = s.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbClear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const s = tx(db, store, "readwrite");
    const req = s.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export function newId() { return id(); }

export async function exportAll() {
  const patients = await dbGetAll("patients");
  const appointments = await dbGetAll("appointments");
  const settings = await dbGetAll("settings");
  return {
    meta: { app: "BTX Agenda PWA", exportedAt: new Date().toISOString(), version: DB_VERSION },
    patients,
    appointments,
    settings
  };
}

export async function importAll(payload) {
  // sobrescreve tudo com o que vier
  await dbClear("patients");
  await dbClear("appointments");
  await dbClear("settings");

  const patients = payload?.patients ?? [];
  const appts = payload?.appointments ?? [];
  const settings = payload?.settings ?? [];

  for (const p of patients) await dbPut("patients", p);
  for (const a of appts) await dbPut("appointments", a);
  for (const s of settings) await dbPut("settings", s);

  return true;
}

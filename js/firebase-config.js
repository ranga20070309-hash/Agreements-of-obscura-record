/**
 * Obscura Rec LLC - Firebase Realtime Database Integration
 * Project: ocr-llc-song-agreements
 * Database URL: https://ocr-llc-song-agreements-default-rtdb.asia-southeast1.firebasedatabase.app
 */

export const firebaseConfig = {
  apiKey: "AIzaSyCIVnIBRC2nEGoqdPcDCooIMgFlwst-pCU",
  authDomain: "ocr-llc-song-agreements.firebaseapp.com",
  databaseURL: "https://ocr-llc-song-agreements-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ocr-llc-song-agreements",
  storageBucket: "ocr-llc-song-agreements.firebasestorage.app",
  messagingSenderId: "626589878135",
  appId: "1:626589878135:web:38ec8fad6910bedd090372"
};

let db = null;
let auth = null;

export function getDatabaseInstance() {
  if (db) return db;
  try {
    if (typeof window !== 'undefined' && window.firebase) {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(firebaseConfig);
      }
      db = window.firebase.database();
      console.log('⚡ Firebase Realtime Database Connected: ocr-llc-song-agreements');
      return db;
    }
  } catch (err) {
    console.warn('Firebase init warning:', err);
  }
  return null;
}

export function getAuthInstance() {
  if (auth) return auth;
  try {
    if (typeof window !== 'undefined' && window.firebase) {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(firebaseConfig);
      }
      auth = window.firebase.auth();
      return auth;
    }
  } catch (err) {
    console.warn('Firebase Auth init warning:', err);
  }
  return null;
}

export async function loginAdmin(email, password) {
  const authInstance = getAuthInstance();
  if (!authInstance) throw new Error('Firebase Authentication is not available.');
  return await authInstance.signInWithEmailAndPassword(email, password);
}

export async function logoutAdmin() {
  const authInstance = getAuthInstance();
  if (!authInstance) return;
  return await authInstance.signOut();
}

export function onAdminAuthStateChanged(callback) {
  const authInstance = getAuthInstance();
  if (!authInstance) {
    if (typeof window !== 'undefined') {
      window.addEventListener('load', () => {
        const a = getAuthInstance();
        if (a) a.onAuthStateChanged(callback);
      });
    }
    return () => {};
  }
  return authInstance.onAuthStateChanged(callback);
}

// Initialize on script load
if (typeof window !== 'undefined') {
  if (window.firebase) {
    getDatabaseInstance();
    getAuthInstance();
  } else {
    window.addEventListener('load', () => {
      getDatabaseInstance();
      getAuthInstance();
    });
  }
}

/**
 * Save / Update active agreement in Firebase Realtime Database
 */
export async function saveAgreementToFirebase(state) {
  if (!state || !state.id) return false;
  const database = getDatabaseInstance();
  if (!database) return false;

  try {
    await database.ref(`agreements/${state.id}`).set(state);
    console.log(`[Firebase RTDB] Saved agreement: ${state.id}`);
    return true;
  } catch (err) {
    console.error('[Firebase RTDB] Save failed:', err);
    return false;
  }
}

/**
 * Fetch agreement from Firebase Realtime Database by ID
 * (Checks active agreements first, then vault archive)
 */
export async function getAgreementFromFirebase(id) {
  if (!id) return null;
  const database = getDatabaseInstance();
  if (!database) return null;

  try {
    // 1. Check active agreements
    const activeSnap = await database.ref(`agreements/${id}`).once('value');
    if (activeSnap.exists()) {
      return activeSnap.val();
    }

    // 2. Check vault archive
    const vaultSnap = await database.ref(`vault/${id}`).once('value');
    if (vaultSnap.exists()) {
      const data = vaultSnap.val();
      return { ...data, isArchivedInVault: true, isLockedForArtist: true };
    }
  } catch (err) {
    console.error('[Firebase RTDB] Fetch error:', err);
  }
  return null;
}

/**
 * Subscribe to live real-time updates for an active agreement
 * (e.g., when artist signs on their device, label screen updates live!)
 */
export function listenToAgreement(id, callback) {
  if (!id || typeof callback !== 'function') return () => {};
  const database = getDatabaseInstance();
  if (!database) return () => {};

  const agreementRef = database.ref(`agreements/${id}`);
  const listener = agreementRef.on('value', (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    }
  }, (err) => {
    console.warn('[Firebase RTDB] Listener error:', err);
  });

  // Return unsubscribe callback
  return () => agreementRef.off('value', listener);
}

/**
 * Archive agreement permanently to Firebase Vault and remove from active temporary queue
 */
export async function finalizeToFirebaseVault(state) {
  if (!state || !state.id) return false;
  const database = getDatabaseInstance();
  if (!database) return false;

  const sealedState = {
    ...state,
    finalizedAt: new Date().toISOString(),
    isArchivedInVault: true,
    isLockedForArtist: true,
    status: 'fully_executed'
  };

  try {
    // 1. Write to permanent vault
    await database.ref(`vault/${state.id}`).set(sealedState);

    // 2. Remove from active temporary agreements queue to keep database clean
    await database.ref(`agreements/${state.id}`).remove();

    console.log(`[Firebase RTDB] Finalized & Archived to Vault: ${state.id}`);
    return sealedState;
  } catch (err) {
    console.error('[Firebase RTDB] Vault archive failed:', err);
    return false;
  }
}

/**
 * List all archived agreements from Firebase Vault
 */
export async function getVaultFromFirebase() {
  const database = getDatabaseInstance();
  if (!database) return [];

  try {
    const snap = await database.ref('vault').once('value');
    if (!snap.exists()) return [];

    const raw = snap.val();
    const records = [];

    Object.keys(raw).forEach((key) => {
      const c = raw[key];
      if (c && typeof c === 'object') {
        records.push({
          id: c.id || key,
          finalizedAt: c.finalizedAt || c.createdAt || new Date().toISOString(),
          artistLegalName: c.artist?.legalName || '',
          artistStageName: c.artist?.stageName || '',
          artistEmail: c.artist?.email || '',
          labelRepresentative: c.label?.representative || '',
          trackCount: Array.isArray(c.tracks) ? c.tracks.length : 0,
          firstTrackTitle: c.tracks?.[0]?.title || '',
          tracksList: Array.isArray(c.tracks) ? c.tracks.map(t => t.title).filter(Boolean) : [],
          hasArtistSignature: Boolean(c.artist?.signature),
          hasLabelSignature: Boolean(c.label?.signature),
          artistSigHash: c.artist?.signature?.hash || 'Verified',
          artistSigTimestamp: c.artist?.signature?.timestamp || '',
          labelSigTimestamp: c.label?.signature?.timestamp || ''
        });
      }
    });

    records.sort((a, b) => new Date(b.finalizedAt) - new Date(a.finalizedAt));
    return records;
  } catch (err) {
    console.error('[Firebase RTDB] Error fetching vault list:', err);
    return [];
  }
}

/**
 * Delete agreement from Firebase Vault
 */
export async function deleteFromFirebaseVault(id) {
  if (!id) return false;
  const database = getDatabaseInstance();
  if (!database) return false;

  try {
    await database.ref(`vault/${id}`).remove();
    console.log(`[Firebase RTDB] Deleted from Vault: ${id}`);
    return true;
  } catch (err) {
    console.error('[Firebase RTDB] Delete from vault failed:', err);
    return false;
  }
}

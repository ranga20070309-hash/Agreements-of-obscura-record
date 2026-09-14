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
      const trySubscribe = () => {
        const a = getAuthInstance();
        if (a) {
          a.onAuthStateChanged(callback);
        } else {
          callback(null);
        }
      };
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(trySubscribe, 50);
      } else {
        window.addEventListener('load', trySubscribe);
      }
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
      return { ...data, isArchivedInVault: true, isLockedForArtist: Boolean(data.status === 'fully_executed') };
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
    // 1. Write full document to permanent vault
    await database.ref(`vault/${state.id}`).set(sealedState);

    // 2. Write lightweight index record to vault_meta (ZERO base64 signatures, NO large text blocks - saves 95%+ bandwidth)
    const metaRecord = {
      id: state.id,
      finalizedAt: sealedState.finalizedAt,
      artistLegalName: state.artist?.legalName || '',
      artistStageName: state.artist?.stageName || '',
      artistEmail: state.artist?.email || '',
      labelRepresentative: state.label?.representative || '',
      labelTitle: state.label?.representativeTitle || 'Director / Founder',
      trackCount: Array.isArray(state.tracks) ? state.tracks.length : 0,
      firstTrackTitle: state.tracks?.[0]?.title || '',
      tracksList: Array.isArray(state.tracks) ? state.tracks.map(t => t.title).filter(Boolean) : [],
      hasArtistSignature: Boolean(state.artist?.signature),
      hasLabelSignature: Boolean(state.label?.signature),
      artistSigHash: state.artist?.signature?.hash || 'Verified',
      artistSigTimestamp: state.artist?.signature?.timestamp || '',
      labelSigTimestamp: state.label?.signature?.timestamp || '',
      labelSigHash: state.label?.signature?.hash || 'OBS-LABEL-SEALED',
      artists: Array.isArray(state.artists) ? state.artists.map(a => ({
        id: a.id,
        role: a.role || 'Recording Artist',
        legalName: a.legalName || '',
        stageName: a.stageName || '',
        email: a.email || '',
        hasSignature: Boolean(a.signature),
        sigHash: a.signature?.hash || 'Verified',
        sigTimestamp: a.signature?.timestamp || a.date || ''
      })) : []
    };
    await database.ref(`vault_meta/${state.id}`).set(metaRecord);

    // 3. Remove from active temporary agreements queue to keep database clean and prevent duplicate storage
    await database.ref(`agreements/${state.id}`).remove();

    console.log(`[Firebase RTDB] Finalized & Archived to Vault: ${state.id} (Indexed in vault_meta)`);
    return sealedState;
  } catch (err) {
    console.error('[Firebase RTDB] Vault archive failed:', err);
    return false;
  }
}

/**
 * Save agreement directly to Vault (without deleting from active agreements)
 * Allows the label to save configured agreements to the vault for future use,
 * while keeping signing links active.
 */
export async function saveAgreementToVault(state) {
  if (!state || !state.id) return false;
  const database = getDatabaseInstance();
  if (!database) return false;

  const savedRecord = {
    ...state,
    savedToVaultAt: state.savedToVaultAt || new Date().toISOString(),
    lastUpdatedInVaultAt: new Date().toISOString(),
    isArchivedInVault: true
  };

  try {
    // 1. Write full document to permanent vault
    await database.ref(`vault/${state.id}`).set(savedRecord);

    // 2. Write lightweight index record to vault_meta
    const metaRecord = {
      id: state.id,
      finalizedAt: savedRecord.savedToVaultAt,
      artistLegalName: state.artist?.legalName || '',
      artistStageName: state.artist?.stageName || '',
      artistEmail: state.artist?.email || '',
      labelRepresentative: state.label?.representative || '',
      labelTitle: state.label?.representativeTitle || 'Director / Founder',
      trackCount: Array.isArray(state.tracks) ? state.tracks.length : 0,
      firstTrackTitle: state.tracks?.[0]?.title || '',
      tracksList: Array.isArray(state.tracks) ? state.tracks.map(t => t.title).filter(Boolean) : [],
      hasArtistSignature: Boolean(state.artist?.signature),
      hasLabelSignature: Boolean(state.label?.signature),
      artistSigHash: state.artist?.signature?.hash || 'Verified',
      artistSigTimestamp: state.artist?.signature?.timestamp || '',
      labelSigTimestamp: state.label?.signature?.timestamp || '',
      labelSigHash: state.label?.signature?.hash || 'OBS-LABEL-SEALED',
      hasSeal: Boolean(state.label?.sealApplied),
      sealFile: state.label?.sealFile || '',
      artists: Array.isArray(state.artists) ? state.artists.map(a => ({
        id: a.id,
        role: a.role || 'Recording Artist',
        legalName: a.legalName || '',
        stageName: a.stageName || '',
        email: a.email || '',
        hasSignature: Boolean(a.signature),
        sigHash: a.signature?.hash || 'Verified',
        sigTimestamp: a.signature?.timestamp || a.date || ''
      })) : []
    };
    await database.ref(`vault_meta/${state.id}`).set(metaRecord);

    // 3. Keep active agreements in sync
    await database.ref(`agreements/${state.id}`).set(state);

    console.log(`[Firebase RTDB] Saved to Vault & Synced: ${state.id}`);
    return true;
  } catch (err) {
    console.error('[Firebase RTDB] Save to Vault failed:', err);
    return false;
  }
}

/**
 * Update vault record if this agreement has been saved in the Vault,
 * keeping signatures and timestamps 100% up-to-date in the Vault.
 */
export async function updateVaultIfArchived(state) {
  if (!state || !state.id) return false;
  const database = getDatabaseInstance();

  try {
    let isInVault = Boolean(state.isArchivedInVault);
    if (!isInVault && database) {
      const checkSnap = await database.ref(`vault/${state.id}`).once('value');
      if (checkSnap.exists()) isInVault = true;
    }

    if (isInVault) {
      if (database) {
        await saveAgreementToVault(state);
      }
      if (typeof window !== 'undefined' && window.location) {
        try {
          fetch('/api/vault/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
          }).catch(() => {});
        } catch (srvErr) {}
      }
      return true;
    }
  } catch (e) {
    console.warn('Check vault update error:', e);
  }
  return false;
}

/**
 * Fetch specific agreement document directly from Firebase Vault
 */
export async function getAgreementFromVault(id) {
  if (!id) return null;
  const database = getDatabaseInstance();
  if (!database) return null;

  try {
    const snap = await database.ref(`vault/${id}`).once('value');
    if (snap.exists()) {
      const data = snap.val();
      return { ...data, isArchivedInVault: true };
    }
  } catch (err) {
    console.warn('[Firebase RTDB] Vault single fetch error:', err);
  }
  return null;
}

/**
 * List all archived agreements from Firebase Vault
 * Uses lightweight vault_meta index to avoid downloading bulky base64 signature payloads
 */
export async function getVaultFromFirebase() {
  const database = getDatabaseInstance();
  if (!database) return [];

  try {
    // 1. Try lightweight vault_meta index if available
    let raw = null;
    try {
      const snap = await database.ref('vault_meta').once('value');
      if (snap.exists() && snap.hasChildren()) {
        raw = snap.val();
      }
    } catch (metaErr) {
      // Ignore permission or index warning, seamlessly fallback to full vault
    }

    // 2. Fetch full vault documents
    if (!raw) {
      const fullSnap = await database.ref('vault').once('value');
      if (fullSnap.exists()) {
        raw = fullSnap.val();
      }
    }

    if (!raw) return [];

    const records = [];

    Object.keys(raw).forEach((key) => {
      const c = raw[key];
      if (c && typeof c === 'object') {
        records.push({
          id: c.id || key,
          finalizedAt: c.finalizedAt || c.createdAt || new Date().toISOString(),
          artistLegalName: c.artistLegalName || c.artist?.legalName || '',
          artistStageName: c.artistStageName || c.artist?.stageName || '',
          artistEmail: c.artistEmail || c.artist?.email || '',
          labelRepresentative: c.labelRepresentative || c.label?.representative || '',
          labelTitle: c.labelTitle || c.label?.representativeTitle || 'Director / Founder',
          trackCount: typeof c.trackCount === 'number' ? c.trackCount : (Array.isArray(c.tracks) ? c.tracks.length : 0),
          firstTrackTitle: c.firstTrackTitle || c.tracks?.[0]?.title || '',
          tracksList: Array.isArray(c.tracksList) ? c.tracksList : (Array.isArray(c.tracks) ? c.tracks.map(t => t.title).filter(Boolean) : []),
          hasArtistSignature: Boolean(c.hasArtistSignature !== undefined ? c.hasArtistSignature : c.artist?.signature),
          hasLabelSignature: Boolean(c.hasLabelSignature !== undefined ? c.hasLabelSignature : c.label?.signature),
          artistSigHash: c.artistSigHash || c.artist?.signature?.hash || 'Verified',
          artistSigTimestamp: c.artistSigTimestamp || c.artist?.signature?.timestamp || '',
          labelSigTimestamp: c.labelSigTimestamp || c.label?.signature?.timestamp || '',
          labelSigHash: c.labelSigHash || c.label?.signature?.hash || 'OBS-LABEL-SEALED',
          artists: Array.isArray(c.artists) ? c.artists.map(a => ({
            id: a.id,
            role: a.role || 'Recording Artist',
            legalName: a.legalName || '',
            stageName: a.stageName || '',
            email: a.email || '',
            hasSignature: Boolean(a.hasSignature !== undefined ? a.hasSignature : a.signature),
            sigHash: a.sigHash || a.signature?.hash || 'Verified',
            sigTimestamp: a.sigTimestamp || a.signature?.timestamp || a.date || ''
          })) : []
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
    await database.ref(`vault_meta/${id}`).remove();
    console.log(`[Firebase RTDB] Deleted from Vault & Meta: ${id}`);
    return true;
  } catch (err) {
    console.error('[Firebase RTDB] Delete from vault failed:', err);
    return false;
  }
}

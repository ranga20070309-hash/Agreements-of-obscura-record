/**
 * Obscura Rec LLC - Administrator Authentication Gate
 * Uses Firebase Authentication (Email/Password) to protect label dashboard
 */

import { loginAdmin, logoutAdmin, onAdminAuthStateChanged } from './firebase-config.js';
import { showToast } from './toast.js';

export class AuthManager {
  constructor(store) {
    this.store = store;
    this.currentUser = null;
    this.isArtistMode = false;

    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      this.isArtistMode = p.get('mode') === 'artist-sign';
    }

    this.modal = document.getElementById('admin-auth-modal');
    this.panel = document.getElementById('admin-auth-panel');
    this.userEmailEl = document.getElementById('admin-user-email');
    this.form = document.getElementById('admin-login-form');
    this.emailInput = document.getElementById('auth-email');
    this.passwordInput = document.getElementById('auth-password');
    this.submitBtn = document.getElementById('btn-auth-submit');
    this.errorMsg = document.getElementById('auth-error-msg');
    this.logoutBtn = document.getElementById('btn-admin-logout');

    this.init();
  }

  init() {
    // If the URL is explicitly an artist-signing link, bypass authentication completely!
    if (this.isArtistMode) {
      document.documentElement.classList.remove('auth-pending', 'auth-required');
      document.body.classList.remove('auth-pending', 'auth-required', 'auth-checking');
      if (this.modal) this.modal.style.display = 'none';
      if (this.panel) this.panel.style.display = 'none';
      return;
    }

    // Check if this browser tab has an active validated session
    const hasActiveSession = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('obscura_admin_session_active') === 'true';

    if (!hasActiveSession) {
      // Fresh visit or reopened tab: purge any persistent local credentials immediately
      try {
        logoutAdmin().catch(() => {});
      } catch (e) {}
      this.onUserLoggedOut();
    }

    // Bind event listeners
    this.bindEvents();

    const safetyTimer = setTimeout(() => {
      const isSessionActive = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('obscura_admin_session_active') === 'true';
      if (!this.currentUser || !isSessionActive) {
        this.onUserLoggedOut();
      }
    }, 1200);

    // Listen to Firebase Auth state
    onAdminAuthStateChanged((user) => {
      clearTimeout(safetyTimer);
      const isSessionActive = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('obscura_admin_session_active') === 'true';
      if (user && isSessionActive) {
        this.onUserLoggedIn(user);
      } else {
        if (user && !isSessionActive) {
          // Stale local credentials detected without an active session in this tab: sign out
          logoutAdmin().catch(() => {});
        }
        this.onUserLoggedOut();
      }
    });
  }

  bindEvents() {
    if (this.form) {
      this.form.addEventListener('submit', (e) => this.handleLogin(e));
    }

    if (this.logoutBtn) {
      this.logoutBtn.addEventListener('click', () => this.handleLogout());
    }
  }

  onUserLoggedIn(user) {
    this.currentUser = user;
    document.documentElement.classList.remove('auth-pending', 'auth-required');
    document.body.classList.remove('auth-pending', 'auth-required', 'auth-checking');

    if (this.modal) {
      this.modal.classList.remove('active');
      this.modal.style.display = 'none';
    }

    if (this.panel) {
      this.panel.style.display = 'inline-flex';
    }

    if (this.userEmailEl) {
      this.userEmailEl.textContent = user.email || 'Authorized Label Admin';
    }

    this.clearError();
  }

  onUserLoggedOut() {
    this.currentUser = null;

    if (this.isArtistMode) {
      return;
    }

    document.documentElement.classList.remove('auth-pending');
    document.documentElement.classList.add('auth-required');
    document.body.classList.remove('auth-pending', 'auth-checking');
    document.body.classList.add('auth-required');

    if (this.modal) {
      this.modal.style.display = 'flex';
      setTimeout(() => this.modal.classList.add('active'), 10);
    }

    if (this.panel) {
      this.panel.style.display = 'none';
    }

    if (this.passwordInput) {
      this.passwordInput.value = '';
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    this.clearError();

    const email = this.emailInput?.value?.trim();
    const password = this.passwordInput?.value;

    if (!email || !password) {
      this.showError('Please enter both administrator email and password.');
      return;
    }

    const origBtnHtml = this.submitBtn ? this.submitBtn.innerHTML : '';
    if (this.submitBtn) {
      this.submitBtn.disabled = true;
      this.submitBtn.innerHTML = '<span>⏳ Verifying Credentials...</span>';
    }

    try {
      const userCredential = await loginAdmin(email, password);
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('obscura_admin_session_active', 'true');
      }
      showToast(`Welcome back, ${userCredential.user.email}!`, 'success');
      this.onUserLoggedIn(userCredential.user);
    } catch (err) {
      console.error('Firebase Auth Login Error:', err);
      let message = 'Failed to sign in. Please verify your credentials.';
      const code = err.code || '';

      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        message = 'Invalid administrator email or password. Please try again.';
      } else if (code === 'auth/invalid-email') {
        message = 'Please provide a valid email address format.';
      } else if (code === 'auth/user-disabled') {
        message = 'This administrator account has been disabled by security policy.';
      } else if (code === 'auth/too-many-requests') {
        message = 'Too many failed login attempts. Please wait a few moments and try again.';
      } else if (err.message) {
        message = err.message;
      }

      this.showError(message);
    } finally {
      if (this.submitBtn) {
        this.submitBtn.disabled = false;
        this.submitBtn.innerHTML = origBtnHtml;
      }
    }
  }

  async handleLogout() {
    if (!confirm('Are you sure you want to sign out of the Obscura Rec LLC management portal?')) {
      return;
    }

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('obscura_admin_session_active');
      }
      await logoutAdmin();
      showToast('Signed out successfully.', 'info');
      this.onUserLoggedOut();
    } catch (err) {
      console.error('Sign out error:', err);
      showToast('Error signing out: ' + err.message, 'error');
    }
  }

  showError(msg) {
    if (this.errorMsg) {
      this.errorMsg.textContent = msg;
      this.errorMsg.style.display = 'block';
    }
  }

  clearError() {
    if (this.errorMsg) {
      this.errorMsg.textContent = '';
      this.errorMsg.style.display = 'none';
    }
  }

  isAuthenticated() {
    return !!this.currentUser;
  }
}

/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Admin Login - Session management
 * Security: CSP-compliant, no inline scripts/handlers
 * Features: Session-based authentication with 24h expiry
 */

(function() {
    'use strict';

    const SESSION_KEY = 'fest_admin_session';
    const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 timmar

    /**
     * Initialize admin login page
     */
    function init() {
        console.log('[Admin] Init starting...');
        
        // Registrera event listeners (CSP-kompatibelt)
        setupEventListeners();
        
        try {
            if (isSessionValid()) {
                console.log('[Admin] Valid session, showing dashboard');
                showDashboard();
            } else {
                console.log('[Admin] No valid session, showing login');
                showLogin();
            }
        } catch (err) {
            console.error('[Admin] Init error:', err);
            showLogin();
        }
    }

    /**
     * Setup all event listeners (CSP-compliant - no inline handlers)
     */
    function setupEventListeners() {
        const loginBtn = document.getElementById('loginBtn');
        const passwordInput = document.getElementById('passwordInput');
        const logoutBtn = document.getElementById('logoutBtn');
        
        if (loginBtn) {
            loginBtn.addEventListener('click', login);
        }
        if (passwordInput) {
            passwordInput.addEventListener('keypress', function(event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    login();
                }
            });
        }
        if (logoutBtn) {
            logoutBtn.addEventListener('click', logout);
        }
    }

    /**
     * Check if current session is valid
     * @returns {boolean} True if session exists and hasn't expired
     */
    function isSessionValid() {
        const session = sessionStorage.getItem(SESSION_KEY);
        if (!session) return false;
        
        try {
            const data = JSON.parse(session);
            const now = Date.now();
            if (now - data.timestamp > SESSION_DURATION) {
                sessionStorage.removeItem(SESSION_KEY);
                return false;
            }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get stored password from session
     * @returns {string|null} The stored password or null
     */
    function getStoredPassword() {
        const session = sessionStorage.getItem(SESSION_KEY);
        if (!session) return null;
        try {
            return JSON.parse(session).password;
        } catch {
            return null;
        }
    }

    /**
     * Attempt login with provided password
     */
    async function login() {
        const passwordInput = document.getElementById('passwordInput');
        const errorEl = document.getElementById('loginError');
        const password = passwordInput ? passwordInput.value : '';
        
        if (!password) {
            showError(errorEl, 'Ange ett lösenord');
            return;
        }

        try {
            // Verifiera mot servern
            const response = await fetch('/api/admin/products', {
                headers: { 
                    'X-Admin-Password': password,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (response.ok) {
                // Spara session
                sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                    password: password,
                    timestamp: Date.now()
                }));
                showDashboard();
            } else if (response.status === 401) {
                showError(errorEl, 'Fel lösenord. Försök igen.');
            } else {
                showError(errorEl, 'Ett fel uppstod. Försök igen.');
            }
        } catch (err) {
            console.error('[Admin] Login error:', err);
            showError(errorEl, 'Kunde inte ansluta till servern');
        }
    }

    /**
     * Display error message
     * @param {HTMLElement} errorEl - Error element
     * @param {string} message - Error message to display
     */
    function showError(errorEl, message) {
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    /**
     * Logout and clear session
     */
    function logout() {
        sessionStorage.removeItem(SESSION_KEY);
        showLogin();
    }

    /**
     * Show login view, hide dashboard
     */
    function showLogin() {
        console.log('[Admin] Showing login view');
        const loginView = document.getElementById('loginView');
        const dashboardView = document.getElementById('dashboardView');
        
        if (loginView) {
            loginView.style.display = 'block';
            loginView.classList.remove('hidden');
        }
        if (dashboardView) {
            dashboardView.style.display = 'none';
            dashboardView.classList.remove('active');
        }
        
        // Clear form
        const passwordInput = document.getElementById('passwordInput');
        const loginError = document.getElementById('loginError');
        if (passwordInput) passwordInput.value = '';
        if (loginError) loginError.style.display = 'none';
    }

    /**
     * Show dashboard, hide login view
     */
    function showDashboard() {
        console.log('[Admin] Showing dashboard view');
        const loginView = document.getElementById('loginView');
        const dashboardView = document.getElementById('dashboardView');
        
        if (loginView) {
            loginView.style.display = 'none';
            loginView.classList.add('hidden');
        }
        if (dashboardView) {
            dashboardView.style.display = 'block';
            dashboardView.classList.add('active');
        }
    }

    // Export för andra admin-sidor
    window.AdminSession = {
        isValid: isSessionValid,
        getPassword: getStoredPassword,
        logout: logout
    };

    // Init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

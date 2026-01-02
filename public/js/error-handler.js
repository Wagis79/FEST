/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Error Handler - Centraliserad felhantering för frontend
 * 
 * Funktioner:
 * - Global error catching (window.onerror, unhandledrejection)
 * - Användarvänliga felmeddelanden
 * - Felrapportering till konsolen
 * - Toast-notifieringar
 */

const ErrorHandler = {
  // Feltyper med användarvänliga meddelanden
  errorMessages: {
    NETWORK_ERROR: 'Kunde inte ansluta till servern. Kontrollera din internetanslutning.',
    SERVER_ERROR: 'Ett serverfel uppstod. Försök igen om en stund.',
    VALIDATION_ERROR: 'Felaktig inmatning. Kontrollera dina värden.',
    TIMEOUT_ERROR: 'Förfrågan tog för lång tid. Försök igen.',
    AUTH_ERROR: 'Åtkomst nekad. Kontrollera dina behörigheter.',
    NOT_FOUND: 'Resursen kunde inte hittas.',
    RATE_LIMIT: 'För många förfrågningar. Vänta en stund och försök igen.',
    UNKNOWN_ERROR: 'Ett oväntat fel uppstod. Försök igen.'
  },

  // Initiera global error handling
  init() {
    // Fånga ej hanterade fel
    window.onerror = (message, source, lineno, colno, error) => {
      this.handleError(error || new Error(message), {
        source,
        lineno,
        colno,
        type: 'uncaught'
      });
      return true; // Förhindra default error handling
    };

    // Fånga ej hanterade promise-rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, {
        type: 'unhandledrejection'
      });
      event.preventDefault();
    });

    console.log('🛡️ ErrorHandler initierad');
  },

  /**
   * Huvudmetod för felhantering
   * @param {Error|string} error - Felobjekt eller felmeddelande
   * @param {Object} context - Extra kontext (optional)
   */
  handleError(error, context = {}) {
    const errorInfo = this.parseError(error);
    
    // Logga till konsolen
    console.error('🚨 Fel:', {
      message: errorInfo.message,
      type: errorInfo.type,
      code: errorInfo.code,
      context,
      stack: error?.stack
    });

    // Visa för användaren (om inte tyst fel)
    if (!context.silent) {
      this.showErrorToUser(errorInfo);
    }

    // Returnera felinfo för vidare hantering
    return errorInfo;
  },

  /**
   * Parsa olika typer av fel till standardformat
   */
  parseError(error) {
    // Om det redan är ett parsed error-objekt
    if (error?.parsed) {
      return error;
    }

    // String-fel
    if (typeof error === 'string') {
      return {
        message: error,
        type: 'UNKNOWN_ERROR',
        code: null,
        parsed: true
      };
    }

    // Fetch/Network-fel
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        message: this.errorMessages.NETWORK_ERROR,
        type: 'NETWORK_ERROR',
        code: null,
        parsed: true
      };
    }

    // API-svar med felstruktur
    if (error?.success === false) {
      return this.parseApiError(error);
    }

    // Standard Error-objekt
    return {
      message: error?.message || this.errorMessages.UNKNOWN_ERROR,
      type: 'UNKNOWN_ERROR',
      code: error?.code || null,
      details: error?.details || null,
      parsed: true
    };
  },

  /**
   * Parsa API-felsvar (från Zod-validering etc)
   */
  parseApiError(response) {
    const type = this.getErrorType(response);
    
    // Om det finns details från Zod-validering
    if (response.details && Array.isArray(response.details)) {
      const detailMessages = response.details
        .map(d => `${d.field}: ${d.message}`)
        .join(', ');
      
      return {
        message: `${response.error}: ${detailMessages}`,
        type,
        code: response.code || null,
        details: response.details,
        parsed: true
      };
    }

    return {
      message: response.error || this.errorMessages[type],
      type,
      code: response.code || null,
      parsed: true
    };
  },

  /**
   * Bestäm feltyp från HTTP-statuskod eller error-objekt
   */
  getErrorType(error) {
    if (error.status) {
      switch (error.status) {
        case 400: return 'VALIDATION_ERROR';
        case 401:
        case 403: return 'AUTH_ERROR';
        case 404: return 'NOT_FOUND';
        case 429: return 'RATE_LIMIT';
        case 500:
        case 502:
        case 503: return 'SERVER_ERROR';
        default: return 'UNKNOWN_ERROR';
      }
    }
    return 'UNKNOWN_ERROR';
  },

  /**
   * Visa fel för användaren via toast eller modal
   */
  showErrorToUser(errorInfo) {
    // Använd befintlig toast-funktion om den finns
    if (typeof showToast === 'function') {
      showToast(errorInfo.message, 'error');
      return;
    }

    // Alternativ: Använd befintlig resultat-container
    const resultsContainer = document.getElementById('results');
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="error-message" style="
          background: #fee2e2;
          border: 1px solid #ef4444;
          border-radius: 8px;
          padding: 16px;
          margin: 16px 0;
          color: #991b1b;
        ">
          <strong>⚠️ Fel</strong>
          <p style="margin: 8px 0 0 0;">${this.escapeHtml(errorInfo.message)}</p>
          ${errorInfo.details ? `
            <details style="margin-top: 8px;">
              <summary style="cursor: pointer;">Visa detaljer</summary>
              <pre style="margin-top: 8px; font-size: 12px; overflow-x: auto;">${this.escapeHtml(JSON.stringify(errorInfo.details, null, 2))}</pre>
            </details>
          ` : ''}
        </div>
      `;
      return;
    }

    // Fallback: Alert
    alert(`Fel: ${errorInfo.message}`);
  },

  /**
   * Escape HTML för säker rendering
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Wrapper för API-anrop med automatisk felhantering
   * @param {Function} apiCall - Async funktion som gör API-anrop
   * @param {Object} options - { silent, onError, fallback }
   */
  async withErrorHandling(apiCall, options = {}) {
    try {
      const result = await apiCall();
      
      // Kolla om API-svaret indikerar fel
      if (result && result.success === false) {
        throw result;
      }
      
      return result;
    } catch (error) {
      const errorInfo = this.handleError(error, { 
        silent: options.silent 
      });
      
      // Custom error handler
      if (options.onError) {
        options.onError(errorInfo);
      }
      
      // Returnera fallback-värde om angivet
      if (options.fallback !== undefined) {
        return options.fallback;
      }
      
      throw errorInfo;
    }
  },

  /**
   * Visa varning (inte fel, men viktig information)
   */
  showWarning(message) {
    console.warn('⚠️ Varning:', message);
    
    if (typeof showToast === 'function') {
      showToast(message, 'warning');
      return;
    }

    // Visa i UI om möjligt
    const warningsContainer = document.getElementById('warnings');
    if (warningsContainer) {
      const warningEl = document.createElement('div');
      warningEl.className = 'warning-message';
      warningEl.innerHTML = `⚠️ ${this.escapeHtml(message)}`;
      warningsContainer.appendChild(warningEl);
    }
  },

  /**
   * Visa varningar från API-svar
   */
  showApiWarnings(response) {
    if (response.warnings && Array.isArray(response.warnings)) {
      response.warnings.forEach(warning => {
        this.showWarning(warning);
      });
    }
  }
};

// Initiera automatiskt när scriptet laddas
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ErrorHandler.init());
} else {
  ErrorHandler.init();
}

// Exponera globalt
window.ErrorHandler = ErrorHandler;

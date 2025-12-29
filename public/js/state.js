/**
 * Global State Management
 * Centraliserad hantering av applikationens tillstånd
 */

const AppState = {
    crops: [],
    products: [],
    currentResultsData: null,
    purchaseListItems: [],
    pendingSolution: null,
    nutrientBalance: null,
    // Lokalt exkluderade produkter (session-baserat, sparas i localStorage)
    excludedProductIds: []
};

// Exportera för användning i andra moduler
window.AppState = AppState;

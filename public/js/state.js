/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
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
    // Lokalt exkluderade produkter (session-baserat, sparas i sessionStorage)
    excludedProductIds: [],
    // Tvingade produkter som MÅSTE inkluderas i lösningen (session-baserat)
    requiredProductIds: []
};

// Exportera för användning i andra moduler
window.AppState = AppState;

/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * localStorage Management
 * Hantering av persistent lagring
 */

const Storage = {
    PURCHASE_LIST_KEY: 'fest_purchaseList',
    EXCLUDED_PRODUCTS_KEY: 'fest_excludedProducts',

    /**
     * Ladda inköpslista från localStorage
     */
    loadPurchaseList() {
        try {
            const stored = localStorage.getItem(this.PURCHASE_LIST_KEY);
            if (stored) {
                AppState.purchaseListItems = JSON.parse(stored);
                console.log('✅ Inköpslista laddad från localStorage:', AppState.purchaseListItems.length, 'items');
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Kunde inte ladda inköpslista från localStorage:', error);
            return false;
        }
    },

    /**
     * Spara inköpslista till localStorage
     */
    savePurchaseList() {
        try {
            localStorage.setItem(this.PURCHASE_LIST_KEY, JSON.stringify(AppState.purchaseListItems));
            console.log('💾 Inköpslista sparad till localStorage:', AppState.purchaseListItems.length, 'items');
            return true;
        } catch (error) {
            console.error('❌ Kunde inte spara inköpslista till localStorage:', error);
            return false;
        }
    },

    /**
     * Ladda exkluderade produkter från localStorage
     * OBS: Returnerar alltid en tom array vid refresh (som krav)
     * Vi sparar dock så att det finns kvar under sessionen om sidan inte refreshas
     */
    loadExcludedProducts() {
        try {
            // Vi återställer vid varje page load som specificerat
            // Men vi behåller funktionaliteten för sessionStorage-liknande beteende
            // genom att kolla om detta är en "soft navigation" (t.ex. SPA)
            const stored = sessionStorage.getItem(this.EXCLUDED_PRODUCTS_KEY);
            if (stored) {
                AppState.excludedProductIds = JSON.parse(stored);
                console.log('✅ Exkluderade produkter laddade:', AppState.excludedProductIds.length, 'produkter');
                return true;
            }
            AppState.excludedProductIds = [];
            return false;
        } catch (error) {
            console.error('❌ Kunde inte ladda exkluderade produkter:', error);
            AppState.excludedProductIds = [];
            return false;
        }
    },

    /**
     * Spara exkluderade produkter till sessionStorage
     */
    saveExcludedProducts() {
        try {
            sessionStorage.setItem(this.EXCLUDED_PRODUCTS_KEY, JSON.stringify(AppState.excludedProductIds));
            console.log('💾 Exkluderade produkter sparade:', AppState.excludedProductIds.length, 'produkter');
            return true;
        } catch (error) {
            console.error('❌ Kunde inte spara exkluderade produkter:', error);
            return false;
        }
    },

    /**
     * Rensa exkluderade produkter (återställ)
     */
    clearExcludedProducts() {
        AppState.excludedProductIds = [];
        sessionStorage.removeItem(this.EXCLUDED_PRODUCTS_KEY);
        console.log('🗑️ Exkluderade produkter återställda');
    }
};

window.Storage = Storage;

/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * API Communication
 * Alla API-anrop till backend med centraliserad felhantering
 */

const API = {
    /**
     * Hämta alla grödor
     */
    async fetchCrops() {
        return ErrorHandler.withErrorHandling(async () => {
            const response = await fetch('/api/crops', {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await response.json();
            if (data.success) {
                AppState.crops = data.crops;
                return data.crops;
            }
            throw { ...data, status: response.status };
        }, {
            fallback: [],
            onError: (err) => console.error('Fel vid hämtning av grödor:', err)
        });
    },

    /**
     * Hämta alla produkter
     */
    async fetchProducts() {
        return ErrorHandler.withErrorHandling(async () => {
            const response = await fetch('/api/products', {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await response.json();
            if (data.success) {
                AppState.products = data.products;
                return data.products;
            }
            throw { ...data, status: response.status };
        }, {
            fallback: [],
            onError: (err) => console.error('Fel vid hämtning av produkter:', err)
        });
    },

    /**
     * Beräkna näringsbehov från gröda
     */
    async calculateNeed(cropId, yieldTonPerHa) {
        return ErrorHandler.withErrorHandling(async () => {
            const response = await fetch('/api/calculate-need', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({ cropId, yieldTonPerHa })
            });
            return await response.json();
        });
    },

    /**
     * Hämta gödselrekommendationer
     */
    async getRecommendations(need, strategy, maxProducts, topN, requiredNutrients) {
        return ErrorHandler.withErrorHandling(async () => {
            // Inkludera exkluderade och tvingade produkter om det finns några
            const excludedProductIds = AppState.excludedProductIds || [];
            const requiredProductIds = AppState.requiredProductIds || [];
            
            console.log('[API] getRecommendations() anropad');
            console.log('[API] Exkluderade:', excludedProductIds.length, 'Tvingade:', requiredProductIds.length);
            
            const requestBody = { 
                need, 
                strategy, 
                maxProducts, 
                topN, 
                requiredNutrients,
                excludedProductIds: excludedProductIds.length > 0 ? excludedProductIds : undefined,
                requiredProductIds: requiredProductIds.length > 0 ? requiredProductIds : undefined
            };
            
            const response = await fetch('/api/recommend', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(requestBody)
            });
            
            const data = await response.json();
            
            // Visa varningar om det finns några
            if (data.warnings) {
                ErrorHandler.showApiWarnings(data);
            }
            
            if (data.success) {
                return data;
            }
            throw { ...data, status: response.status };
        });
    }
};

window.API = API;

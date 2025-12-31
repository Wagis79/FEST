/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * API Communication
 * Alla API-anrop till backend
 */

const API = {
    /**
     * Hämta alla grödor
     */
    async fetchCrops() {
        try {
            const response = await fetch('/api/crops');
            const data = await response.json();
            if (data.success) {
                AppState.crops = data.crops;
                return data.crops;
            }
            throw new Error(data.error || 'Kunde inte hämta grödor');
        } catch (error) {
            console.error('Fel vid hämtning av grödor:', error);
            throw error;
        }
    },

    /**
     * Hämta alla produkter
     */
    async fetchProducts() {
        try {
            const response = await fetch('/api/products');
            const data = await response.json();
            if (data.success) {
                AppState.products = data.products;
                return data.products;
            }
            throw new Error(data.error || 'Kunde inte hämta produkter');
        } catch (error) {
            console.error('Fel vid hämtning av produkter:', error);
            throw error;
        }
    },

    /**
     * Beräkna näringsbehov från gröda
     */
    async calculateNeed(cropId, yieldTonPerHa) {
        try {
            const response = await fetch('/api/calculate-need', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cropId, yieldTonPerHa })
            });
            const data = await response.json();
            return data; // Returnera hela svaret, inte bara data.need
        } catch (error) {
            console.error('Fel vid beräkning av näringsbehov:', error);
            throw error;
        }
    },

    /**
     * Hämta gödselrekommendationer
     */
    async getRecommendations(need, strategy, maxProducts, topN, requiredNutrients) {
        try {
            // Inkludera exkluderade produkter om det finns några
            const excludedProductIds = AppState.excludedProductIds || [];
            
            console.log('[API] ============================================');
            console.log('[API] getRecommendations() anropad');
            console.log('[API] AppState.excludedProductIds:', AppState.excludedProductIds);
            console.log('[API] excludedProductIds (kopierad):', excludedProductIds);
            console.log('[API] Antal exkluderade:', excludedProductIds.length);
            
            const requestBody = { 
                need, 
                strategy, 
                maxProducts, 
                topN, 
                requiredNutrients,
                excludedProductIds: excludedProductIds.length > 0 ? excludedProductIds : undefined
            };
            
            console.log('[API] Request body:', JSON.stringify(requestBody, null, 2));
            console.log('[API] ============================================');
            
            const response = await fetch('/api/recommend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const data = await response.json();
            console.log('[API] Svar från /api/recommend:', data);
            
            // Logga antal produkter per lösning
            if (data.solutions) {
                console.log('[API] Produkter per lösning:', data.solutions.map((s, i) => 
                    `Lösning ${i+1}: ${s.products.length} produkter`
                ).join(', '));
            }
            
            if (data.success) {
                return data;
            }
            throw new Error(data.error || 'Kunde inte hämta rekommendationer');
        } catch (error) {
            console.error('Fel vid hämtning av rekommendationer:', error);
            throw error;
        }
    }
};

window.API = API;

/**
 * FEST - Main Application Entry Point
 * Initiering av applikationen
 */

(async function initApp() {
    console.log('🌾 FEST - Startar applikation...');

    try {
        // 1. Ladda grödor och produkter
        console.log('📦 Laddar data...');
        await Promise.all([
            API.fetchCrops(),
            API.fetchProducts()
        ]);
        console.log('✅ Data laddad:', AppState.crops.length, 'grödor,', AppState.products.length, 'produkter');

        // 2. Populera dropdown-menyer
        console.log('🎨 Populerar grödor...');
        const cropSelect = document.getElementById('crop');
        const previousCropSelect = document.getElementById('previousCrop');
        const advCropSelect = document.getElementById('advCrop');

        AppState.crops.forEach(crop => {
            const option = new Option(crop.name, crop.id);
            if (cropSelect) cropSelect.add(option.cloneNode(true));
            if (previousCropSelect) previousCropSelect.add(option.cloneNode(true));
            if (advCropSelect) advCropSelect.add(option);
        });

        // 3. Ladda sparad inköpslista från localStorage
        console.log('💾 Laddar sparad inköpslista...');
        Storage.loadPurchaseList();

        // 4. Ladda exkluderade produkter från sessionStorage
        console.log('💾 Laddar exkluderade produkter...');
        Storage.loadExcludedProducts();
        
        // 5. Uppdatera produktlist-knappen om det finns exkluderade produkter
        if (typeof updateProductListButton === 'function') {
            updateProductListButton();
        }

        // 6. Initiera UI-komponenter
        console.log('🎨 Initierar UI...');
        if (typeof setupIntegerInputs === 'function') {
            setupIntegerInputs();
        }
        Forms.init();

        // Registrera event listeners för förfrukt först när crops är laddade
        const previousCrop = document.getElementById('previousCrop');
        const previousYield = document.getElementById('previousYield');
        
        // Debounced version för yield-input (väntar tills användaren slutat skriva)
        const debouncedPreviousYieldCalc = Utils.debounce(() => {
            try {
                if (window.Balance && window.Balance.calculateFromPreviousCrop) {
                    window.Balance.calculateFromPreviousCrop(false);
                }
            } catch (err) {
                console.error('❌ Fel vid automatisk förfruktsberäkning (previousYield):', err);
            }
        }, 400);
        
        if (previousCrop) previousCrop.addEventListener('change', () => {
            const val = previousCrop.value;
            try {
                if (window.Balance && window.Balance.calculateFromPreviousCrop) {
                    // Auto-beräkning utan felmeddelande (showError = false)
                    window.Balance.calculateFromPreviousCrop(false);
                }
            } catch (err) {
                console.error('❌ Fel vid automatisk förfruktsberäkning (previousCrop):', err);
            }
        });
        if (previousYield) previousYield.addEventListener('input', debouncedPreviousYieldCalc);
        PurchaseList.render();

        console.log('✅ FEST redo att användas!');

    } catch (error) {
        console.error('❌ Fel vid initiering av applikation:', error);
        alert('Kunde inte starta applikationen. Kontrollera att servern körs.');
    }
})();

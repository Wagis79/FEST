/**
 * FEST - Event Listeners
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Centraliserade event listeners för index.html
 * Ersätter inline onclick/onchange handlers för bättre CSP-kompatibilitet
 */

(function() {
    'use strict';

    /**
     * Setup integer inputs to prevent decimals on key fields
     */
    function setupIntegerInputs() {
        const integerInputs = ['yield', 'nInput', 'pInput', 'kInput', 'sInput'];
        integerInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', function() {
                    this.value = this.value.replace(/[.,]/g, '');
                });
            }
        });
    }

    /**
     * Initiera loader
     */
    function initLoader() {
        if (typeof SpreaderLoader !== 'undefined') {
            window.spreaderLoader = new SpreaderLoader({ minDisplayTime: 7000 });
        }
    }

    /**
     * Initiera alla event listeners när DOM är redo
     */
    function initEventListeners() {
        // =========================================
        // Header & Navigation
        // =========================================
        
        // Visa produktlista-knappen
        const productListBtn = document.getElementById('productListBtn');
        if (productListBtn) {
            productListBtn.addEventListener('click', function() {
                if (typeof showProductList === 'function') {
                    showProductList();
                }
            });
        }

        // Toggle formläge (Enkel/Avancerad)
        const formModeToggle = document.getElementById('formModeToggle');
        if (formModeToggle) {
            formModeToggle.addEventListener('click', function() {
                if (typeof toggleFormMode === 'function') {
                    toggleFormMode();
                }
            });
        }

        // Tillbaka-knapp från inköpslista
        const backToCalcBtn = document.getElementById('backToCalcBtn');
        if (backToCalcBtn) {
            backToCalcBtn.addEventListener('click', function() {
                if (typeof TabManager !== 'undefined' && TabManager.showCalculationTabs) {
                    TabManager.showCalculationTabs();
                }
            });
        }

        // Inköpslista-flik
        const purchaseTab = document.querySelector('.tab[data-tab="purchase"]');
        if (purchaseTab) {
            purchaseTab.addEventListener('click', function() {
                if (typeof switchTab === 'function') {
                    switchTab('purchase');
                }
            });
        }

        // =========================================
        // Balance Mode & Calculation
        // =========================================

        // Toggle balansläge
        const balanceToggle = document.getElementById('balanceToggle');
        if (balanceToggle) {
            balanceToggle.addEventListener('click', function() {
                if (typeof toggleBalanceMode === 'function') {
                    toggleBalanceMode();
                }
            });
        }

        // Beräkna näringsbalans från förfrukt
        const calculateBalanceBtn = document.getElementById('calculateBalanceBtn');
        if (calculateBalanceBtn) {
            calculateBalanceBtn.addEventListener('click', function() {
                if (typeof calculateBalance === 'function') {
                    calculateBalance();
                }
            });
        }

        // Använd direkt angiven näringsbalans
        const useDirectBalanceBtn = document.getElementById('useDirectBalanceBtn');
        if (useDirectBalanceBtn) {
            useDirectBalanceBtn.addEventListener('click', function() {
                if (typeof useDirectBalance === 'function') {
                    useDirectBalance();
                }
            });
        }

        // =========================================
        // Add to List Modal
        // =========================================

        // Avbryt lägg till i lista
        const cancelAddToListBtn = document.getElementById('cancelAddToListBtn');
        if (cancelAddToListBtn) {
            cancelAddToListBtn.addEventListener('click', function() {
                if (typeof closeAddToListModal === 'function') {
                    closeAddToListModal();
                }
            });
        }

        // Bekräfta lägg till i lista
        const confirmAddToListBtn = document.getElementById('confirmAddToListBtn');
        if (confirmAddToListBtn) {
            confirmAddToListBtn.addEventListener('click', function() {
                if (typeof confirmAddToList === 'function') {
                    confirmAddToList();
                }
            });
        }

        // =========================================
        // Print Options Modal
        // =========================================

        // Avbryt utskrift
        const cancelPrintBtn = document.getElementById('cancelPrintBtn');
        if (cancelPrintBtn) {
            cancelPrintBtn.addEventListener('click', function() {
                if (typeof PurchaseList !== 'undefined' && PurchaseList.closePrintOptionsModal) {
                    PurchaseList.closePrintOptionsModal();
                }
            });
        }

        // Bekräfta utskrift
        const confirmPrintBtn = document.getElementById('confirmPrintBtn');
        if (confirmPrintBtn) {
            confirmPrintBtn.addEventListener('click', function() {
                if (typeof PurchaseList !== 'undefined' && PurchaseList.confirmPrint) {
                    PurchaseList.confirmPrint();
                }
            });
        }

        // =========================================
        // Product Modal
        // =========================================

        // Stäng produktlista
        const productModalClose = document.querySelector('.product-modal-close');
        if (productModalClose) {
            productModalClose.addEventListener('click', function() {
                if (typeof closeProductList === 'function') {
                    closeProductList();
                }
            });
        }

        // Återställ exkluderade produkter
        const resetExclusionsBtn = document.getElementById('resetExclusionsBtn');
        if (resetExclusionsBtn) {
            resetExclusionsBtn.addEventListener('click', function() {
                if (typeof resetExcludedProducts === 'function') {
                    resetExcludedProducts();
                }
            });
        }

        // Stäng modal vid klick utanför
        const productModal = document.getElementById('productModal');
        if (productModal) {
            window.addEventListener('click', function(event) {
                if (event.target === productModal) {
                    if (typeof closeProductList === 'function') {
                        closeProductList();
                    }
                }
            });
        }

        // Initiera integer inputs och loader
        setupIntegerInputs();
        initLoader();

        console.log('✅ Event listeners initierade');
    }

    // Exportera setupIntegerInputs för bakåtkompatibilitet
    window.setupIntegerInputs = setupIntegerInputs;

    // Initiera när DOM är redo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEventListeners);
    } else {
        initEventListeners();
    }
})();

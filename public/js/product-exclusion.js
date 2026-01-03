/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Product Exclusion & Requirement Management
 * Hanterar exkluderade och tvingade produkter för beräkning
 * 
 * Trevalsstatus per produkt:
 * - Normal (standard): Produkten kan användas om optimeraren väljer den
 * - Exkluderad: Produkten exkluderas från alla beräkningar
 * - Tvingad: Produkten MÅSTE inkluderas i alla lösningar
 */

const ProductExclusion = {
    /**
     * Hämta produktens nuvarande status
     * @returns 'normal' | 'excluded' | 'required'
     */
    getProductStatus(productId) {
        if (AppState.requiredProductIds?.includes(productId)) {
            return 'required';
        }
        if (AppState.excludedProductIds?.includes(productId)) {
            return 'excluded';
        }
        return 'normal';
    },

    /**
     * Uppdatera visuell indikation på produktlistknappen
     */
    updateButton() {
        const btn = document.getElementById('productListBtn');
        if (!btn) {
            console.warn('[ProductExclusion] Knappen productListBtn hittades inte');
            return;
        }
        
        const excludedCount = AppState.excludedProductIds?.length || 0;
        const requiredCount = AppState.requiredProductIds?.length || 0;
        const totalModified = excludedCount + requiredCount;
        
        if (totalModified > 0) {
            btn.classList.add('has-exclusions');
            btn.setAttribute('data-excluded-count', totalModified);
            
            const parts = [];
            if (excludedCount > 0) parts.push(`${excludedCount} exkluderade`);
            if (requiredCount > 0) parts.push(`${requiredCount} tvingade`);
            btn.setAttribute('data-tooltip', parts.join(', '));
        } else {
            btn.classList.remove('has-exclusions');
            btn.removeAttribute('data-excluded-count');
            btn.removeAttribute('data-tooltip');
        }
    },

    /**
     * Sätt produktens status
     * @param productId - Produkt-ID
     * @param status - 'normal' | 'excluded' | 'required'
     */
    setStatus(productId, status) {
        // Initialisera arrayer om de inte finns
        if (!AppState.excludedProductIds) AppState.excludedProductIds = [];
        if (!AppState.requiredProductIds) AppState.requiredProductIds = [];
        
        // Ta bort från båda listor först
        AppState.excludedProductIds = AppState.excludedProductIds.filter(id => id !== productId);
        AppState.requiredProductIds = AppState.requiredProductIds.filter(id => id !== productId);
        
        // Lägg till i rätt lista baserat på status
        if (status === 'excluded') {
            AppState.excludedProductIds.push(productId);
        } else if (status === 'required') {
            AppState.requiredProductIds.push(productId);
        }
        // 'normal' = inte i någon lista
        
        // Spara till sessionStorage
        Storage.saveExcludedProducts();
        Storage.saveRequiredProducts();
        
        // Uppdatera knappens utseende
        this.updateButton();
        
        // Uppdatera rad-styling
        this.updateRowStyling(productId, status);
        
        // Uppdatera footer-text och reset-knapp
        this.updateModalFooter();
    },

    /**
     * Uppdatera rad-styling baserat på status
     */
    updateRowStyling(productId, status) {
        const row = document.querySelector(`tr[data-product-id="${productId}"]`);
        if (!row) return;
        
        // Ta bort alla status-klasser
        row.classList.remove('product-row-excluded', 'product-row-required');
        
        // Lägg till rätt klass
        if (status === 'excluded') {
            row.classList.add('product-row-excluded');
        } else if (status === 'required') {
            row.classList.add('product-row-required');
        }
    },

    /**
     * Hantera klick på statusknapp
     */
    cycleStatus(productId) {
        const currentStatus = this.getProductStatus(productId);
        
        // Cykla: normal -> required -> excluded -> normal
        let newStatus;
        switch (currentStatus) {
            case 'normal':
                newStatus = 'required';
                break;
            case 'required':
                newStatus = 'excluded';
                break;
            case 'excluded':
            default:
                newStatus = 'normal';
                break;
        }
        
        this.setStatus(productId, newStatus);
        
        // Uppdatera knappen i tabellen
        this.updateStatusButton(productId, newStatus);
    },

    /**
     * Uppdatera statusknappens utseende
     */
    updateStatusButton(productId, status) {
        const btn = document.querySelector(`button[data-product-id="${productId}"]`);
        if (!btn) return;
        
        // Uppdatera knappens utseende och text
        btn.className = 'status-btn status-' + status;
        
        switch (status) {
            case 'required':
                btn.innerHTML = '🔒 Tvingad';
                btn.title = 'Klicka för att exkludera';
                break;
            case 'excluded':
                btn.innerHTML = '❌ Exkluderad';
                btn.title = 'Klicka för att återställa';
                break;
            default:
                btn.innerHTML = '✓ Normal';
                btn.title = 'Klicka för att tvinga';
        }
    },

    /**
     * Uppdatera footer med rätt antal och reset-knapp
     */
    updateModalFooter() {
        const countText = document.getElementById('productCountText');
        const resetBtn = document.getElementById('resetExclusionsBtn');
        if (!countText || !resetBtn) return;
        
        const totalProducts = AppState.products?.length || 0;
        const excludedCount = AppState.excludedProductIds?.length || 0;
        const requiredCount = AppState.requiredProductIds?.length || 0;
        const activeCount = totalProducts - excludedCount;
        
        const hasModifications = excludedCount > 0 || requiredCount > 0;
        
        if (hasModifications) {
            let statusParts = [];
            if (excludedCount > 0) statusParts.push(`<span style="color: #ff4444;">${excludedCount} exkluderade</span>`);
            if (requiredCount > 0) statusParts.push(`<span style="color: #28a745;">${requiredCount} tvingade</span>`);
            
            countText.innerHTML = `<strong>${activeCount}</strong> av ${totalProducts} produkter aktiva (${statusParts.join(', ')})`;
            resetBtn.disabled = false;
        } else {
            countText.innerHTML = `<strong>${totalProducts}</strong> tillgängliga produkter för beräkning`;
            resetBtn.disabled = true;
        }
    },

    /**
     * Återställ alla exkluderade och tvingade produkter
     */
    resetAll() {
        Storage.clearExcludedProducts();
        Storage.clearRequiredProducts();
        this.updateButton();
        
        // Uppdatera alla rader och knappar i tabellen
        const rows = document.querySelectorAll('tr[data-product-id]');
        rows.forEach(row => {
            const productId = row.getAttribute('data-product-id');
            row.classList.remove('product-row-excluded', 'product-row-required');
            this.updateStatusButton(productId, 'normal');
        });
        
        this.updateModalFooter();
        console.log('🗑️ Alla produktval återställda (exkluderade och tvingade)');
    },

    /**
     * Lägg till event listeners för statusknapparna (CSP-kompatibelt)
     * Ersätter inline onclick-attribut
     */
    attachStatusButtonListeners() {
        const buttons = document.querySelectorAll('.status-btn[data-product-id]');
        buttons.forEach(btn => {
            // Ta bort eventuella befintliga listeners genom att klona
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            // Lägg till ny listener
            newBtn.addEventListener('click', (e) => {
                const productId = e.currentTarget.getAttribute('data-product-id');
                if (productId) {
                    this.cycleStatus(productId);
                }
            });
        });
        console.log(`✅ ${buttons.length} statusknapp-listeners registrerade`);
    },

    /**
     * Visa produktlista modal
     */
    async showModal() {
        const modal = document.getElementById('productModal');
        const tbody = document.getElementById('productTableBody');
        
        // Visa modal
        modal.style.display = 'block';
        
        try {
            // Hämta produkter från API
            const response = await fetch('/api/products', {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await response.json();
            
            if (data.success && data.products) {
                // Spara produkter i state
                AppState.products = data.products;
                
                // Sortera på artikelnummer
                const products = data.products.sort((a, b) => {
                    const aNum = parseInt(a.id.replace('prod-', ''));
                    const bNum = parseInt(b.id.replace('prod-', ''));
                    return aNum - bNum;
                });
                
                // Bygg tabell med statusknapp per rad
                tbody.innerHTML = products.map(p => {
                    const articleNr = p.id.replace('prod-', '');
                    const status = this.getProductStatus(p.id);
                    
                    const formatNutrient = (val) => {
                        if (!val || val === 0) return '<span class="nutrient-zero">-</span>';
                        return `<span class="nutrient-value">${val}</span>`;
                    };
                    
                    // Skapa statusknapp
                    let btnClass = 'status-btn status-' + status;
                    let btnText, btnTitle;
                    switch (status) {
                        case 'required':
                            btnText = '🔒 Tvingad';
                            btnTitle = 'Klicka för att exkludera';
                            break;
                        case 'excluded':
                            btnText = '❌ Exkluderad';
                            btnTitle = 'Klicka för att återställa';
                            break;
                        default:
                            btnText = '✓ Normal';
                            btnTitle = 'Klicka för att tvinga';
                    }
                    
                    const rowClass = status === 'excluded' ? 'product-row-excluded' : 
                                     status === 'required' ? 'product-row-required' : '';
                    
                    return `
                        <tr data-product-id="${p.id}" class="${rowClass}">
                            <td class="product-status-cell">
                                <button class="${btnClass}" 
                                        data-product-id="${p.id}"
                                        title="${btnTitle}">
                                    ${btnText}
                                </button>
                            </td>
                            <td>${articleNr}</td>
                            <td><strong>${p.name}</strong></td>
                            <td>${formatNutrient(p.nutrients.N)}</td>
                            <td>${formatNutrient(p.nutrients.P)}</td>
                            <td>${formatNutrient(p.nutrients.K)}</td>
                            <td>${formatNutrient(p.nutrients.S)}</td>
                        </tr>
                    `;
                }).join('');
                
                // Lägg till event listeners för statusknapparna (CSP-kompatibelt)
                this.attachStatusButtonListeners();
                
                // Uppdatera footer
                this.updateModalFooter();
            } else {
                document.getElementById('productCountText').textContent = 'Kunde inte ladda produkter';
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 40px; color: #dc3545;">
                            Kunde inte ladda produkter
                        </td>
                    </tr>
                `;
            }
        } catch (error) {
            console.error('Fel vid hämtning av produkter:', error);
            document.getElementById('productCountText').textContent = 'Fel vid laddning';
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 40px; color: #dc3545;">
                        Serverfel: ${error.message}
                    </td>
                </tr>
            `;
        }
    },

    /**
     * Stäng produktlista modal
     */
    closeModal() {
        document.getElementById('productModal').style.display = 'none';
    }
};

// Globala wrapper-funktioner för onclick-attribut
function showProductList() {
    ProductExclusion.showModal();
}

function closeProductList() {
    ProductExclusion.closeModal();
}

function resetExcludedProducts() {
    ProductExclusion.resetAll();
}

function updateProductListButton() {
    ProductExclusion.updateButton();
}

// Debug-funktion - kan anropas från konsollen
function debugExcludedProducts() {
    console.log('===========================================');
    console.log('🔍 DEBUG: Produktexkludering & Tvingade');
    console.log('===========================================');
    console.log('AppState.excludedProductIds:', AppState.excludedProductIds);
    console.log('AppState.requiredProductIds:', AppState.requiredProductIds);
    console.log('Antal exkluderade:', AppState.excludedProductIds?.length || 0);
    console.log('Antal tvingade:', AppState.requiredProductIds?.length || 0);
    console.log('sessionStorage (excluded):', sessionStorage.getItem('fest_excludedProducts'));
    console.log('sessionStorage (required):', sessionStorage.getItem('fest_requiredProducts'));
    console.log('AppState.products antal:', AppState.products?.length || 0);
    console.log('===========================================');
    return {
        excludedIds: AppState.excludedProductIds,
        requiredIds: AppState.requiredProductIds,
        excludedCount: AppState.excludedProductIds?.length || 0,
        requiredCount: AppState.requiredProductIds?.length || 0
    };
}

// Exportera för användning
window.ProductExclusion = ProductExclusion;
window.showProductList = showProductList;
window.closeProductList = closeProductList;
window.resetExcludedProducts = resetExcludedProducts;
window.updateProductListButton = updateProductListButton;
window.debugExcludedProducts = debugExcludedProducts;

/**
 * Product Exclusion Management
 * Hanterar lokalt exkluderade produkter för beräkning
 */

const ProductExclusion = {
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
        console.log('[ProductExclusion] updateButton() - excludedCount:', excludedCount);
        
        if (excludedCount > 0) {
            btn.classList.add('has-exclusions');
            btn.setAttribute('data-excluded-count', excludedCount);
            btn.setAttribute('data-tooltip', `${excludedCount} produkt(er) exkluderade från beräkning`);
            console.log('[ProductExclusion] ✅ Knapp uppdaterad med röd ram');
        } else {
            btn.classList.remove('has-exclusions');
            btn.removeAttribute('data-excluded-count');
            btn.removeAttribute('data-tooltip');
            console.log('[ProductExclusion] Knapp återställd (inga exkluderingar)');
        }
    },

    /**
     * Hantera toggle av produkt-exkludering
     */
    toggle(productId, isChecked) {
        console.log(`[ProductExclusion] toggle() - productId: ${productId}, isChecked: ${isChecked}`);
        
        if (!AppState.excludedProductIds) {
            console.warn('[ProductExclusion] AppState.excludedProductIds är undefined, initierar tom array');
            AppState.excludedProductIds = [];
        }
        
        if (isChecked) {
            // Ta bort från exkluderade
            AppState.excludedProductIds = AppState.excludedProductIds.filter(id => id !== productId);
        } else {
            // Lägg till i exkluderade
            if (!AppState.excludedProductIds.includes(productId)) {
                AppState.excludedProductIds.push(productId);
            }
        }
        
        // Spara till sessionStorage
        Storage.saveExcludedProducts();
        
        // Uppdatera knappens utseende
        this.updateButton();
        
        // Uppdatera rad-styling
        const row = document.querySelector(`tr[data-product-id="${productId}"]`);
        if (row) {
            if (isChecked) {
                row.classList.remove('product-row-excluded');
            } else {
                row.classList.add('product-row-excluded');
            }
        }
        
        // Uppdatera footer-text och reset-knapp
        this.updateModalFooter();
        
        console.log(`[ProductExclusion] ✅ Produkt ${productId} ${isChecked ? 'inkluderad' : 'exkluderad'}. Totalt exkluderade: ${AppState.excludedProductIds.length}`);
        console.log('[ProductExclusion] Aktuella exkluderade produkter:', AppState.excludedProductIds);
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
        const activeCount = totalProducts - excludedCount;
        
        if (excludedCount > 0) {
            countText.innerHTML = `<strong>${activeCount}</strong> av ${totalProducts} produkter aktiva (<span style="color: #ff4444;">${excludedCount} exkluderade</span>)`;
            resetBtn.disabled = false;
        } else {
            countText.innerHTML = `<strong>${totalProducts}</strong> tillgängliga produkter för beräkning`;
            resetBtn.disabled = true;
        }
    },

    /**
     * Återställ alla exkluderade produkter
     */
    resetAll() {
        Storage.clearExcludedProducts();
        this.updateButton();
        
        // Uppdatera alla checkboxar och rader i tabellen
        const checkboxes = document.querySelectorAll('.product-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = true;
            const row = cb.closest('tr');
            if (row) {
                row.classList.remove('product-row-excluded');
            }
        });
        
        this.updateModalFooter();
        console.log('🗑️ Alla produktexkluderingar återställda');
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
            const response = await fetch('/api/products');
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
                
                // Bygg tabell med checkboxar
                tbody.innerHTML = products.map(p => {
                    const articleNr = p.id.replace('prod-', '');
                    const isExcluded = AppState.excludedProductIds.includes(p.id);
                    const formatNutrient = (val) => {
                        if (!val || val === 0) return '<span class="nutrient-zero">-</span>';
                        return `<span class="nutrient-value">${val}</span>`;
                    };
                    
                    return `
                        <tr data-product-id="${p.id}" class="${isExcluded ? 'product-row-excluded' : ''}">
                            <td class="product-checkbox-cell">
                                <input type="checkbox" 
                                       class="product-checkbox" 
                                       ${isExcluded ? '' : 'checked'} 
                                       onchange="ProductExclusion.toggle('${p.id}', this.checked)"
                                       title="${isExcluded ? 'Klicka för att inkludera' : 'Klicka för att exkludera'}">
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

function toggleProductExclusion(productId, isChecked) {
    ProductExclusion.toggle(productId, isChecked);
}

function updateProductListButton() {
    ProductExclusion.updateButton();
}

// Debug-funktion - kan anropas från konsollen
function debugExcludedProducts() {
    console.log('===========================================');
    console.log('🔍 DEBUG: Produktexkludering');
    console.log('===========================================');
    console.log('AppState.excludedProductIds:', AppState.excludedProductIds);
    console.log('Antal exkluderade:', AppState.excludedProductIds?.length || 0);
    console.log('sessionStorage:', sessionStorage.getItem('fest_excludedProducts'));
    console.log('AppState.products antal:', AppState.products?.length || 0);
    console.log('===========================================');
    return {
        excludedIds: AppState.excludedProductIds,
        count: AppState.excludedProductIds?.length || 0,
        sessionStorage: sessionStorage.getItem('fest_excludedProducts')
    };
}

// Exportera för användning
window.ProductExclusion = ProductExclusion;
window.showProductList = showProductList;
window.closeProductList = closeProductList;
window.resetExcludedProducts = resetExcludedProducts;
window.toggleProductExclusion = toggleProductExclusion;
window.updateProductListButton = updateProductListButton;
window.debugExcludedProducts = debugExcludedProducts;

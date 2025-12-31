/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Purchase List Management
 * Hantering av inköpslista
 */

const PurchaseList = {
    /**
     * Lägg till lösning i inköpslistan
     */
    addItem(solutionOrIndex) {
        // Hantera både solution-objekt och index för bakåtkompatibilitet
        let solution;
        if (typeof solutionOrIndex === 'number') {
            solution = AppState.currentResultsData.solutions[solutionOrIndex];
        } else {
            solution = solutionOrIndex;
        }
        
        if (!solution) {
            console.error('No solution found');
            return;
        }
        
        AppState.pendingSolution = solution;
        
        // Öppna modal för namn och hektar
        document.getElementById('addToListModal').style.display = 'flex';
        
        // Förfyll med aktuell gröda (readonly)
        const cropId = document.getElementById('crop').value || document.getElementById('advCrop').value;
        const crop = AppState.crops.find(c => c.id === cropId);
        document.getElementById('listItemCrop').value = crop ? crop.name : 'Okänd gröda';
        
        // Töm beskrivningsfältet
        document.getElementById('listItemDescription').value = '';
        
        // Sätt default hektar
        const hectaresInput = document.getElementById('listItemHectares');
        hectaresInput.value = '10';
        
        // Lägg till event listener för att rensa när användaren börjar skriva
        hectaresInput.onfocus = function() {
            if (this.value === '10') {
                this.value = '';
            }
        };
        
        // Fokusera på beskrivningsfältet
        document.getElementById('listItemDescription').focus();
    },

    /**
     * Bekräfta och lägg till i listan
     */
    confirmAdd() {
        console.log('🟢 START confirmAdd()');
        
        const cropName = document.getElementById('listItemCrop').value.trim();
        const description = document.getElementById('listItemDescription').value.trim();
        const hectares = parseFloat(document.getElementById('listItemHectares').value);

        console.log('📝 Form values:', { cropName, description, hectares });

        if (!hectares || hectares <= 0) {
            console.log('❌ Hectares invalid:', hectares);
            alert('Ange antal hektar');
            return;
        }

        if (!AppState.pendingSolution) {
            console.log('❌ No pending solution');
            return;
        }

        console.log('✅ Pending solution OK');

        // Bygg fullständigt namn: "Höstvete" eller "Höstvete - Klimat & Natur"
        const fullName = description ? `${cropName} - ${description}` : cropName;

        const item = {
            id: Date.now(),
            cropName: cropName,
            description: description,
            displayName: fullName,
            hectares: hectares,
            solution: JSON.parse(JSON.stringify(AppState.pendingSolution)), // Deep copy
            costPerHa: AppState.pendingSolution.costPerHa,
            timestamp: new Date().toISOString(), // Lägg till timestamp
            addedDate: new Date().toLocaleDateString('sv-SE', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        };

        console.log('📦 Item created:', item);

        AppState.purchaseListItems.push(item);
        console.log('📋 List length after push:', AppState.purchaseListItems.length);
        
        Storage.savePurchaseList();
        console.log('💾 Saved to storage');
        
        this.render();
        console.log('🎨 Rendered');
        
        this.closeModal();
        console.log('🚪 Modal closed');
        
        this.showToast();
        console.log('🔔 Toast shown');
        
        console.log('🏁 END confirmAdd()');
    },

    /**
     * Stäng modal
     */
    closeModal() {
        document.getElementById('addToListModal').style.display = 'none';
        AppState.pendingSolution = null;
    },

    /**
     * Visa toast-meddelande
     */
    showToast() {
        const toast = document.getElementById('toast');
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },

    /**
     * Ta bort item från listan
     */
    removeItem(itemId) {
        if (confirm('Ta bort denna post från inköpslistan?')) {
            AppState.purchaseListItems = AppState.purchaseListItems.filter(item => item.id !== itemId);
            Storage.savePurchaseList();
            this.render();
        }
    },

    /**
     * Uppdatera hektar för ett item
     */
    updateHectares(itemId, newHectares) {
        const hectares = parseFloat(newHectares);
        if (!hectares || hectares <= 0) {
            alert('Ange ett giltigt antal hektar');
            this.render(); // Reset to previous value
            return;
        }

        const item = AppState.purchaseListItems.find(i => i.id === itemId);
        if (item) {
            item.hectares = hectares;
            Storage.savePurchaseList();
            this.render();
        }
    },

    /**
     * Beräkna sammanfattning av inköpslistan
     */
    calculateSummary() {
        const items = AppState.purchaseListItems;
        let totalHectares = 0;
        let totalCost = 0;
        const productSummary = {};

        items.forEach(item => {
            totalHectares += item.hectares;
            totalCost += item.costPerHa * item.hectares;

            item.solution.products.forEach(p => {
                const product = AppState.products.find(prod => prod.id === p.productId);
                if (product) {
                    if (!productSummary[p.productId]) {
                        // Hämta näringsinnehåll - kan vara product.nutrients.X eller product.X beroende på källa
                        const nutrients = product.nutrients || {};
                        productSummary[p.productId] = {
                            name: product.name,
                            totalKg: 0,
                            pricePerKg: product.pricePerKg || product.price || 0,
                            N: nutrients.N || product.N || 0,
                            P: nutrients.P || product.P || 0,
                            K: nutrients.K || product.K || 0,
                            S: nutrients.S || product.S || 0
                        };
                    }
                    productSummary[p.productId].totalKg += p.kgPerHa * item.hectares;
                }
            });
        });

        // Beräkna totalt produktpris
        let totalProductCost = 0;
        Object.values(productSummary).forEach(p => {
            p.estimatedCost = p.totalKg * p.pricePerKg;
            totalProductCost += p.estimatedCost;
        });

        return {
            itemCount: items.length,
            totalHectares,
            totalCost,
            totalProductCost,
            productCount: Object.keys(productSummary).length,
            products: productSummary
        };
    },

    /**
     * Kopiera produktlista till clipboard
     */
    copyToClipboard() {
        const summary = this.calculateSummary();
        let text = '📋 INKÖPSLISTA - GÖDSELREKOMMENDATIONER\n';
        text += '═'.repeat(45) + '\n\n';
        
        text += `📊 SAMMANFATTNING\n`;
        text += `   Antal fält: ${summary.itemCount}\n`;
        text += `   Total areal: ${Utils.formatNumber(summary.totalHectares)} ha\n`;
        text += `   Uppskattad kostnad: ${Utils.formatNumber(summary.totalCost)} kr\n\n`;
        
        text += `📦 PRODUKTER ATT BESTÄLLA\n`;
        text += '─'.repeat(45) + '\n';
        
        // Sortera produkter efter mängd
        const sortedProducts = Object.entries(summary.products)
            .sort((a, b) => b[1].totalKg - a[1].totalKg);
        
        sortedProducts.forEach(([id, product]) => {
            const amount = Utils.formatWeight(product.totalKg);
            text += `   ${product.name}: ${amount}\n`;
        });
        
        text += '\n─'.repeat(45) + '\n';
        text += `Genererad: ${new Date().toLocaleDateString('sv-SE', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })}\n`;

        navigator.clipboard.writeText(text).then(() => {
            this.showToast('Kopierat till urklipp!');
        }).catch(() => {
            // Fallback för äldre webbläsare
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showToast('Kopierat till urklipp!');
        });
    },

    /**
     * Visa utskriftsalternativ-dialogen
     */
    showPrintOptions() {
        // Återställ formuläret
        document.getElementById('printCustomerName').value = '';
        document.getElementById('printQuoteNumber').value = '';
        document.getElementById('printShowPrices').checked = true;
        
        // Visa modal
        document.getElementById('printOptionsModal').style.display = 'flex';
        
        // Fokusera på kundnamn
        document.getElementById('printCustomerName').focus();
    },

    /**
     * Stäng utskriftsalternativ-dialogen
     */
    closePrintOptionsModal() {
        document.getElementById('printOptionsModal').style.display = 'none';
    },

    /**
     * Bekräfta och generera utskrift
     */
    confirmPrint() {
        const customerName = document.getElementById('printCustomerName').value.trim();
        const quoteNumber = document.getElementById('printQuoteNumber').value.trim();
        const showPrices = document.getElementById('printShowPrices').checked;
        
        this.closePrintOptionsModal();
        this.printList({ customerName, quoteNumber, showPrices });
    },

    /**
     * Generera och visa utskriftsvänlig PDF-liknande vy
     */
    printList(options = {}) {
        const { customerName = '', quoteNumber = '', showPrices = true } = options;
        const summary = this.calculateSummary();
        const today = new Date().toLocaleDateString('sv-SE', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric'
        });

        // Sortera produkter efter mängd
        const sortedProducts = Object.entries(summary.products)
            .sort((a, b) => b[1].totalKg - a[1].totalKg);

        // Bygg produkttabell-rader
        let productRows = '';
        sortedProducts.forEach(([id, product]) => {
            const nutrients = `${product.N}-${product.P}-${product.K}-${product.S}`;
            const amount = Utils.formatWeight(product.totalKg);
            const cost = product.pricePerKg > 0 
                ? Utils.formatNumber(product.estimatedCost) + ' kr' 
                : '—';
            
            productRows += `
                <tr>
                    <td>${product.name}</td>
                    <td class="text-right bold purple">${amount}</td>
                    <td class="text-center mono">${nutrients}</td>
                    ${showPrices ? `<td class="text-right">${cost}</td>` : ''}
                </tr>
            `;
        });

        // Bygg fältlösningar - kompakt format
        let fieldRows = '';
        AppState.purchaseListItems.forEach(item => {
            const displayName = item.displayName || item.customName || item.cropName;
            const totalCost = Utils.formatNumber(item.costPerHa * item.hectares);
            const costPerHa = Utils.formatNumber(item.costPerHa);
            const products = item.solution.products.map(p => {
                const product = AppState.products.find(prod => prod.id === p.productId);
                return `${product ? product.name : p.productId} (${Utils.formatNumber(p.kgPerHa)} kg/ha)`;
            }).join(' • ');
            
            fieldRows += `
                <tr>
                    <td>
                        <strong>${displayName}</strong>
                        <div class="field-products">${products}</div>
                    </td>
                    <td class="text-right">${item.hectares} ha</td>
                    ${showPrices ? `
                    <td class="text-right">${costPerHa} kr/ha</td>
                    <td class="text-right bold green">${totalCost} kr</td>
                    ` : ''}
                </tr>
            `;
        });

        // Skapa HTML-dokument optimerat för A4 utskrift
        const printHTML = `
<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <title>Inköpslista - Gödselrekommendationer</title>
    <style>
        @page {
            size: A4;
            margin: 15mm;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 11px;
            color: #333;
            line-height: 1.4;
            padding: 20px;
            max-width: 210mm;
            margin: 0 auto;
            background: white;
        }
        
        /* Header */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 15px;
            border-bottom: 2px solid #667eea;
            margin-bottom: 20px;
        }
        
        .header-left h1 {
            font-size: 22px;
            color: #333;
            margin-bottom: 2px;
        }
        
        .header-left .subtitle {
            color: #888;
            font-size: 11px;
        }
        
        .header-right {
            text-align: right;
            font-size: 10px;
            color: #666;
        }
        
        .header-right .date {
            font-weight: 600;
            color: #667eea;
        }
        
        /* Summary Grid */
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-bottom: 20px;
        }
        
        .summary-box {
            background: #f8f9fa;
            border-radius: 6px;
            padding: 12px 10px;
            text-align: center;
            border: 1px solid #e8e8e8;
        }
        
        .summary-box .value {
            font-size: 18px;
            font-weight: 700;
            color: #333;
        }
        
        .summary-box .value.green { color: #4CAF50; }
        
        .summary-box .label {
            font-size: 9px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-top: 3px;
        }
        
        /* Sections */
        .section {
            margin-bottom: 20px;
        }
        
        .section-title {
            font-size: 13px;
            color: #333;
            margin-bottom: 10px;
            padding-bottom: 6px;
            border-bottom: 1px solid #ddd;
        }
        
        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
        }
        
        thead {
            background: #667eea;
        }
        
        thead th {
            padding: 8px 10px;
            text-align: left;
            color: white;
            font-weight: 600;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        
        tbody td {
            padding: 8px 10px;
            border-bottom: 1px solid #eee;
            vertical-align: top;
        }
        
        tbody tr:last-child td {
            border-bottom: none;
        }
        
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .bold { font-weight: 600; }
        .purple { color: #667eea; }
        .green { color: #4CAF50; }
        .mono { font-family: 'SF Mono', Monaco, monospace; font-size: 9px; }
        
        .field-products {
            font-size: 9px;
            color: #888;
            margin-top: 3px;
        }
        
        .total-row {
            background: #f8f9fa;
        }
        
        .total-row td {
            padding: 10px !important;
            border-top: 2px solid #667eea;
            font-weight: 600;
        }
        
        /* Footer */
        .footer {
            margin-top: 25px;
            padding-top: 12px;
            border-top: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            font-size: 9px;
            color: #aaa;
        }
        
        /* Print button */
        .print-btn {
            position: fixed;
            top: 15px;
            right: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 3px 10px rgba(102, 126, 234, 0.3);
            z-index: 1000;
        }
        
        .print-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 5px 14px rgba(102, 126, 234, 0.4);
        }
        
        @media print {
            .print-btn { display: none; }
            body { padding: 0; }
            .section { page-break-inside: avoid; }
        }
        
        @media screen {
            body {
                background: #f0f0f0;
                padding: 30px;
            }
            .page {
                background: white;
                padding: 20px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                border-radius: 4px;
            }
        }
    </style>
</head>
<body>
    <button class="print-btn" onclick="window.print()">🖨️ Skriv ut / Spara PDF</button>
    
    <div class="page">
        <div class="header">
            <div class="header-left">
                <h1>📋 ${customerName ? 'Offert' : 'Inköpslista'}</h1>
                <div class="subtitle">Gödselrekommendationer</div>
                ${customerName ? `<div class="customer-name" style="margin-top: 8px; font-weight: 600; color: #333;">${customerName}</div>` : ''}
            </div>
            <div class="header-right">
                ${quoteNumber ? `<div class="quote-number" style="font-weight: 600; color: #667eea; margin-bottom: 4px;">Offert: ${quoteNumber}</div>` : ''}
                <div class="date">${today}</div>
                <div>FEST Beslutsstöd</div>
            </div>
        </div>

        <div class="summary-grid">
            <div class="summary-box">
                <div class="value">${summary.itemCount}</div>
                <div class="label">Fält</div>
            </div>
            <div class="summary-box">
                <div class="value">${Utils.formatNumber(summary.totalHectares)}</div>
                <div class="label">Hektar totalt</div>
            </div>
            <div class="summary-box">
                <div class="value">${summary.productCount}</div>
                <div class="label">Produkter</div>
            </div>
            ${showPrices ? `
            <div class="summary-box">
                <div class="value green">${Utils.formatNumber(summary.totalCost)} kr</div>
                <div class="label">Total kostnad</div>
            </div>
            ` : `
            <div class="summary-box">
                <div class="value">—</div>
                <div class="label">Kostnad</div>
            </div>
            `}
        </div>

        <div class="section">
            <h2 class="section-title">📦 Produkter att beställa</h2>
            <table>
                <thead>
                    <tr>
                        <th style="width: ${showPrices ? '40%' : '50%'};">Produkt</th>
                        <th style="width: ${showPrices ? '20%' : '25%'}; text-align: right;">Mängd</th>
                        <th style="width: ${showPrices ? '20%' : '25%'}; text-align: center;">N-P-K-S</th>
                        ${showPrices ? `<th style="width: 20%; text-align: right;">Uppsk. kostnad</th>` : ''}
                    </tr>
                </thead>
                <tbody>
                    ${productRows}
                    ${showPrices && summary.totalProductCost > 0 ? `
                    <tr class="total-row">
                        <td colspan="3" class="text-right">Uppskattat totalt:</td>
                        <td class="text-right green">${Utils.formatNumber(summary.totalProductCost)} kr</td>
                    </tr>
                    ` : ''}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2 class="section-title">🌱 Fältlösningar</h2>
            <table>
                <thead>
                    <tr>
                        <th style="width: ${showPrices ? '40%' : '60%'};">Fält / Gröda</th>
                        <th style="width: ${showPrices ? '15%' : '40%'}; text-align: right;">Areal</th>
                        ${showPrices ? `
                        <th style="width: 20%; text-align: right;">Kostnad/ha</th>
                        <th style="width: 25%; text-align: right;">Totalt</th>
                        ` : ''}
                    </tr>
                </thead>
                <tbody>
                    ${fieldRows}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <div>FEST - Beslutsstöd för gödselrekommendationer</div>
            <div>Genererad: ${today}</div>
        </div>
    </div>
</body>
</html>
        `;

        // Öppna i nytt fönster
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printHTML);
        printWindow.document.close();
    },

    /**
     * Visa toast-meddelande med custom text
     */
    showToast(message = 'Tillagd i inköpslistan!') {
        const toast = document.getElementById('toast');
        const messageEl = toast.querySelector('.toast-message');
        if (messageEl) {
            messageEl.textContent = message;
        }
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },

    /**
     * Rendera inköpslistan
     */
    render() {
        const container = document.getElementById('purchaseTabContent');
        const badge = document.getElementById('purchaseCount');
        
        // Om elementen inte finns än, avbryt (händer vid initial load)
        if (!container || !badge) {
            console.log('⏭️ Render skipped - elements not ready');
            return;
        }
        
        console.log('🎨 Rendering purchase list...', AppState.purchaseListItems.length, 'items');
        
        // Uppdatera badge
        if (AppState.purchaseListItems.length > 0) {
            badge.textContent = AppState.purchaseListItems.length;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }

        // Om listan är tom
        if (AppState.purchaseListItems.length === 0) {
            container.innerHTML = `
                <div class="empty-purchase-list">
                    <div class="empty-purchase-list-icon">🌱</div>
                    <h3>Din inköpslista är tom</h3>
                    <p>Lägg till gödslingsrekommendationer för dina fält och se den totala produktlistan här.</p>
                    <div class="empty-purchase-tips">
                        <div class="tip-item">
                            <span class="tip-icon">1️⃣</span>
                            <span>Välj gröda och ange näringsbehov</span>
                        </div>
                        <div class="tip-item">
                            <span class="tip-icon">2️⃣</span>
                            <span>Beräkna rekommendationer</span>
                        </div>
                        <div class="tip-item">
                            <span class="tip-icon">3️⃣</span>
                            <span>Klicka "Lägg till i inköpslista" på en lösning</span>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        // Beräkna sammanfattning
        const summary = this.calculateSummary();

        // === BYGG HTML ===
        let html = '';

        // Dashboard - Sammanfattning högst upp
        html += `
            <div class="purchase-dashboard">
                <div class="dashboard-stat dashboard-stat-primary">
                    <div class="dashboard-stat-icon">🌾</div>
                    <div class="dashboard-stat-content">
                        <span class="dashboard-stat-value">${summary.itemCount}</span>
                        <span class="dashboard-stat-label">Fält / Lösningar</span>
                    </div>
                </div>
                <div class="dashboard-stat dashboard-stat-secondary">
                    <div class="dashboard-stat-icon">📐</div>
                    <div class="dashboard-stat-content">
                        <span class="dashboard-stat-value">${Utils.formatNumber(summary.totalHectares)}</span>
                        <span class="dashboard-stat-label">Hektar totalt</span>
                    </div>
                </div>
                <div class="dashboard-stat dashboard-stat-tertiary">
                    <div class="dashboard-stat-icon">📦</div>
                    <div class="dashboard-stat-content">
                        <span class="dashboard-stat-value">${summary.productCount}</span>
                        <span class="dashboard-stat-label">Produkter</span>
                    </div>
                </div>
                <div class="dashboard-stat dashboard-stat-success">
                    <div class="dashboard-stat-icon">💰</div>
                    <div class="dashboard-stat-content">
                        <span class="dashboard-stat-value">${Utils.formatNumber(summary.totalCost)}</span>
                        <span class="dashboard-stat-label">Kronor totalt</span>
                    </div>
                </div>
            </div>
        `;

        // Verktygsfält med knappar
        html += `
            <div class="purchase-toolbar">
                <div class="toolbar-title">
                    <h3>📋 Beställningslista</h3>
                    <span class="toolbar-subtitle">Produkter att köpa in</span>
                </div>
                <div class="toolbar-actions">
                    <button onclick="PurchaseList.copyToClipboard()" class="btn-toolbar" title="Kopiera till urklipp">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                        </svg>
                        <span>Kopiera</span>
                    </button>
                    <button onclick="PurchaseList.showPrintOptions()" class="btn-toolbar" title="Skriv ut">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        <span>Skriv ut</span>
                    </button>
                </div>
            </div>
        `;

        // Produkttabell - Sorterad efter mängd
        const sortedProducts = Object.entries(summary.products)
            .sort((a, b) => b[1].totalKg - a[1].totalKg);

        html += `
            <div class="product-table-card">
                <table class="product-table">
                    <thead>
                        <tr>
                            <th class="col-product">Produkt</th>
                            <th class="col-amount">Mängd</th>
                            <th class="col-nutrients">Innehåll (N-P-K-S)</th>
                            <th class="col-price">Uppsk. kostnad</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        sortedProducts.forEach(([productId, product]) => {
            const nutrients = `${product.N}-${product.P}-${product.K}-${product.S}`;
            const estimatedCost = product.pricePerKg > 0 
                ? Utils.formatNumber(product.estimatedCost) + ' kr' 
                : '—';
            
            html += `
                <tr>
                    <td class="col-product">
                        <div class="product-name-cell">
                            <span class="product-icon">📦</span>
                            <span>${product.name}</span>
                        </div>
                    </td>
                    <td class="col-amount">
                        <strong>${Utils.formatWeight(product.totalKg)}</strong>
                    </td>
                    <td class="col-nutrients">
                        <span class="nutrient-badge">${nutrients}</span>
                    </td>
                    <td class="col-price">${estimatedCost}</td>
                </tr>
            `;
        });

        // Total-rad om vi har priser
        if (summary.totalProductCost > 0) {
            html += `
                <tr class="table-total-row">
                    <td colspan="3" class="total-label">Uppskattat totalt:</td>
                    <td class="total-value">${Utils.formatNumber(summary.totalProductCost)} kr</td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        // Sektionsrubrik för sparade lösningar
        html += `
            <div class="purchase-section-header">
                <h3>🌱 Sparade fältlösningar</h3>
                <span class="section-subtitle">Klicka för att visa detaljer</span>
            </div>
        `;
        
        // Rendera varje sparad lösning som kompakt kort
        AppState.purchaseListItems.forEach((item, index) => {
            const totalCost = item.costPerHa * item.hectares;
            
            // Använd displayName om det finns, annars fallback till gamla strukturen
            const displayName = item.displayName || item.customName || item.cropName;
            
            // Formatera datum
            const dateAdded = item.addedDate || new Date(item.timestamp || item.id).toLocaleDateString('sv-SE', { 
                month: 'short', 
                day: 'numeric'
            });
            
            // Kompakt produktlista
            const productNames = item.solution.products.map(p => {
                const product = AppState.products.find(prod => prod.id === p.productId);
                return product ? product.name : p.productId;
            }).join(', ');
            
            html += `
                <div class="field-card" onclick="PurchaseList.toggleFieldDetails(${item.id})">
                    <div class="field-card-main">
                        <div class="field-card-info">
                            <span class="field-card-name">${displayName}</span>
                            <span class="field-card-meta">${productNames}</span>
                        </div>
                        <div class="field-card-stats">
                            <div class="field-stat">
                                <span class="field-stat-value">${item.hectares}</span>
                                <span class="field-stat-label">ha</span>
                            </div>
                            <div class="field-stat field-stat-cost">
                                <span class="field-stat-value">${Utils.formatNumber(totalCost)}</span>
                                <span class="field-stat-label">kr</span>
                            </div>
                            <button onclick="event.stopPropagation(); PurchaseList.removeItem(${item.id})" class="btn-remove-field" title="Ta bort">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 6L6 18M6 6l12 12"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="field-card-details" id="field-details-${item.id}">
                        <div class="field-details-row">
                            <span class="field-details-label">Tillagd:</span>
                            <span class="field-details-value">${dateAdded}</span>
                        </div>
                        <div class="field-details-row">
                            <span class="field-details-label">Kostnad/ha:</span>
                            <span class="field-details-value">${Utils.formatNumber(item.costPerHa)} kr</span>
                        </div>
                        <div class="field-details-products">
                            <span class="field-details-label">Produkter:</span>
                            ${item.solution.products.map(p => {
                                const product = AppState.products.find(prod => prod.id === p.productId);
                                const totalForProduct = p.kgPerHa * item.hectares;
                                return `
                                    <div class="field-product-item">
                                        <span>${product ? product.name : p.productId}</span>
                                        <span>${Utils.formatNumber(p.kgPerHa)} kg/ha → ${Utils.formatWeight(totalForProduct)}</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        <div class="field-details-actions">
                            <label class="hectares-edit">
                                <span>Ändra areal:</span>
                                <input type="number" value="${item.hectares}" 
                                       onclick="event.stopPropagation()"
                                       onchange="event.stopPropagation(); PurchaseList.updateHectares(${item.id}, this.value)"
                                       min="0.1" step="0.5">
                                <span>ha</span>
                            </label>
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    /**
     * Toggle field card details
     */
    toggleFieldDetails(itemId) {
        const details = document.getElementById(`field-details-${itemId}`);
        if (details) {
            details.classList.toggle('expanded');
        }
    }
};

window.PurchaseList = PurchaseList;
window.addToPurchaseList = PurchaseList.addItem.bind(PurchaseList);
window.confirmAddToList = PurchaseList.confirmAdd.bind(PurchaseList);
window.closeAddToListModal = PurchaseList.closeModal.bind(PurchaseList);
window.removeFromList = PurchaseList.removeItem.bind(PurchaseList);
window.updateHectares = PurchaseList.updateHectares.bind(PurchaseList);
window.renderPurchaseList = PurchaseList.render.bind(PurchaseList);

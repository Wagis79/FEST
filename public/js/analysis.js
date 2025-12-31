/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Product Analysis
 * Analyzes product pricing and nutrient costs
 */

let analysisData = null;
let currentSort = { column: null, ascending: true };

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadAnalysis();
    setupTabs();
    setupTableSorting();
});

/**
 * Load product analysis from API
 */
async function loadAnalysis() {
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const statsEl = document.getElementById('stats');

    // Session key - same as other admin pages
    const SESSION_KEY = 'fest_admin_session';

    try {
        loadingEl.style.display = 'block';
        errorEl.style.display = 'none';
        statsEl.style.display = 'none';

        // Check session for password
        const session = sessionStorage.getItem(SESSION_KEY);
        let adminPassword = null;
        
        if (session) {
            try {
                const data = JSON.parse(session);
                // Check if session is still valid (24 hours)
                const now = Date.now();
                const sessionAge = now - data.timestamp;
                const maxAge = 24 * 60 * 60 * 1000;
                if (sessionAge < maxAge) {
                    adminPassword = data.password;
                }
            } catch (e) {
                console.error('Session parse error:', e);
            }
        }
        
        if (!adminPassword) {
            // Redirect to admin login page
            window.location.href = '/admin.html';
            return;
        }

        const response = await fetch('/api/admin/product-analysis', {
            headers: {
                'x-admin-password': adminPassword
            }
        });

        if (!response.ok) {
            if (response.status === 403) {
                // Clear invalid session and redirect to login
                sessionStorage.removeItem(SESSION_KEY);
                window.location.href = '/admin.html';
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Okänt fel');
        }

        analysisData = data;
        displayAnalysis(data);

        loadingEl.style.display = 'none';
        statsEl.style.display = 'block';

    } catch (error) {
        console.error('Failed to load analysis:', error);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        document.getElementById('error-message').textContent = error.message;
    }
}

/**
 * Display analysis data
 */
function displayAnalysis(data) {
    // Update stats with more insightful metrics
    document.getElementById('stat-total').textContent = data.totalProducts;
    
    // Calculate price range
    const prices = data.analysis.map(p => p.pricePerKg).sort((a, b) => a - b);
    const minPrice = prices[0].toFixed(1);
    const maxPrice = prices[prices.length - 1].toFixed(1);
    document.getElementById('stat-price-range').textContent = `${minPrice} - ${maxPrice} kr/kg`;
    
    // Find cheapest sources for N, P, K
    const cheapestN = findCheapestSource(data.analysis, 'N');
    const cheapestP = findCheapestSource(data.analysis, 'P');
    const cheapestK = findCheapestSource(data.analysis, 'K');
    
    if (cheapestN) {
        document.getElementById('stat-cheapest-n').textContent = `${cheapestN.cost.toFixed(1)} kr/kg`;
        document.getElementById('stat-cheapest-n-product').textContent = truncateName(cheapestN.name, 25);
    }
    
    if (cheapestP) {
        document.getElementById('stat-cheapest-p').textContent = `${cheapestP.cost.toFixed(1)} kr/kg`;
        document.getElementById('stat-cheapest-p-product').textContent = truncateName(cheapestP.name, 25);
    }
    
    if (cheapestK) {
        document.getElementById('stat-cheapest-k').textContent = `${cheapestK.cost.toFixed(1)} kr/kg`;
        document.getElementById('stat-cheapest-k-product').textContent = truncateName(cheapestK.name, 25);
    }

    // Display products table
    displayProductsTable(data.analysis);

    // Display cheapest sources
    displayCheapestSources(data.cheapestSources);
}

/**
 * Find cheapest source for a nutrient
 */
function findCheapestSource(products, nutrient) {
    let cheapest = null;
    
    for (const product of products) {
        const cost = product.costPerNutrient[nutrient];
        if (cost !== null && cost !== undefined && cost > 0) {
            if (!cheapest || cost < cheapest.cost) {
                cheapest = { name: product.name, cost: cost };
            }
        }
    }
    
    return cheapest;
}

/**
 * Truncate product name
 */
function truncateName(name, maxLength) {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 2) + '...';
}

/**
 * Display products in table
 */
function displayProductsTable(products) {
    const tbody = document.getElementById('products-tbody');
    tbody.innerHTML = '';

    products.forEach(product => {
        const row = document.createElement('tr');

        // Product name
        const nameCell = document.createElement('td');
        nameCell.innerHTML = `<div class="product-name">${product.name}</div>`;
        row.appendChild(nameCell);

        // Price per kg
        const priceCell = document.createElement('td');
        priceCell.textContent = `${product.pricePerKg.toFixed(2)} kr`;
        row.appendChild(priceCell);

        // Nutrients badges
        const nutrientsCell = document.createElement('td');
        const badges = product.usableNutrients.map(n => 
            `<span class="nutrient-badge nutrient-${n}">${n}: ${product.nutrients[n]}%</span>`
        ).join(' ');
        nutrientsCell.innerHTML = badges || '<span style="color: #999;">-</span>';
        row.appendChild(nutrientsCell);

        // Cost per nutrient (N, P, K, S)
        ['N', 'P', 'K', 'S'].forEach(nutrient => {
            const costCell = document.createElement('td');
            const cost = product.costPerNutrient[nutrient];

            if (cost !== null && cost !== undefined) {
                costCell.innerHTML = `<div class="cost-cell ${getCostClass(cost, nutrient)}">${cost.toFixed(2)} kr</div>`;
            } else {
                costCell.innerHTML = `<div class="cost-na">-</div>`;
            }

            row.appendChild(costCell);
        });

        tbody.appendChild(row);
    });
}

/**
 * Get CSS class for cost (cheap/medium/expensive)
 */
function getCostClass(cost, nutrient) {
    if (!analysisData) return 'cost-medium';

    // Find all costs for this nutrient
    const costs = analysisData.analysis
        .map(p => p.costPerNutrient[nutrient])
        .filter(c => c !== null && c !== undefined)
        .sort((a, b) => a - b);

    if (costs.length === 0) return 'cost-medium';

    // Calculate percentiles
    const p33 = costs[Math.floor(costs.length * 0.33)];
    const p66 = costs[Math.floor(costs.length * 0.66)];

    if (cost <= p33) return 'cost-cheap';
    if (cost <= p66) return 'cost-medium';
    return 'cost-expensive';
}

/**
 * Display cheapest sources
 */
function displayCheapestSources(cheapestSources) {
    ['N', 'P', 'K', 'S'].forEach(nutrient => {
        const list = document.getElementById(`cheapest-${nutrient}`);
        list.innerHTML = '';

        const products = cheapestSources[nutrient];

        if (products.length === 0) {
            list.innerHTML = '<li style="color: #999; padding: 12px 0;">Inga produkter med detta näringsämne</li>';
            return;
        }

        products.forEach((product, index) => {
            const li = document.createElement('li');
            li.className = 'product-item';

            const cost = product.costPerNutrient[nutrient];
            const nutrientPercent = product.nutrients[nutrient];

            li.innerHTML = `
                <div class="product-item-rank">${index + 1}</div>
                <div class="product-item-name">
                    ${product.name}
                    <div style="font-size: 0.85rem; color: #666; margin-top: 3px;">
                        ${nutrientPercent}% ${nutrient} • ${product.pricePerKg.toFixed(2)} kr/kg produkt
                    </div>
                </div>
                <div class="product-item-cost">${cost.toFixed(2)} kr/kg</div>
            `;

            list.appendChild(li);
        });
    });
}

/**
 * Setup tabs
 */
function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active content
            tabContents.forEach(content => {
                if (content.id === `tab-${targetTab}`) {
                    content.classList.add('active');
                } else {
                    content.classList.remove('active');
                }
            });
        });
    });
}

/**
 * Setup table sorting
 */
function setupTableSorting() {
    const headers = document.querySelectorAll('th[data-sort]');

    headers.forEach(header => {
        header.addEventListener('click', () => {
            const sortBy = header.dataset.sort;
            sortTable(sortBy);
        });
    });
}

/**
 * Sort table by column
 */
function sortTable(column) {
    if (!analysisData) return;

    // Toggle sort direction if same column
    if (currentSort.column === column) {
        currentSort.ascending = !currentSort.ascending;
    } else {
        currentSort.column = column;
        currentSort.ascending = true;
    }

    // Sort data
    const sorted = [...analysisData.analysis].sort((a, b) => {
        let aVal, bVal;

        switch (column) {
            case 'name':
                aVal = a.name.toLowerCase();
                bVal = b.name.toLowerCase();
                break;
            case 'price':
                aVal = a.pricePerKg;
                bVal = b.pricePerKg;
                break;
            case 'costN':
                aVal = a.costPerNutrient.N ?? 999999;
                bVal = b.costPerNutrient.N ?? 999999;
                break;
            case 'costP':
                aVal = a.costPerNutrient.P ?? 999999;
                bVal = b.costPerNutrient.P ?? 999999;
                break;
            case 'costK':
                aVal = a.costPerNutrient.K ?? 999999;
                bVal = b.costPerNutrient.K ?? 999999;
                break;
            case 'costS':
                aVal = a.costPerNutrient.S ?? 999999;
                bVal = b.costPerNutrient.S ?? 999999;
                break;
            default:
                return 0;
        }

        if (aVal < bVal) return currentSort.ascending ? -1 : 1;
        if (aVal > bVal) return currentSort.ascending ? 1 : -1;
        return 0;
    });

    // Update table
    displayProductsTable(sorted);

    // Update sort icons
    document.querySelectorAll('th').forEach(th => {
        th.classList.remove('sorted');
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = '▼';
    });

    const activeHeader = document.querySelector(`th[data-sort="${column}"]`);
    if (activeHeader) {
        activeHeader.classList.add('sorted');
        const icon = activeHeader.querySelector('.sort-icon');
        if (icon) icon.textContent = currentSort.ascending ? '▲' : '▼';
    }
}

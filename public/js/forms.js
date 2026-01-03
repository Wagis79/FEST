/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Forms Module
 * Hantering av formulär, beräkningar och resultatvisning
 */

const Forms = {
    // Flagga för att förhindra dubbelklick
    isCalculating: false,
    
    // Debounced versioner av beräkningsfunktioner (skapas i init)
    debouncedCalculateNutrientNeed: null,
    debouncedCalculateAdvancedNutrientNeed: null,
    
    /**
     * Beräkna näringsbehov från gröda (Enkel flik)
     */
    async calculateNutrientNeed() {
        const cropId = document.getElementById('crop').value;
        const yieldValue = parseFloat(document.getElementById('yield').value);

        // Om gröda eller skörd saknas, töm näringsbehovsfälten
        if (!cropId || !yieldValue || yieldValue <= 0) {
            document.getElementById('nitrogen').value = '';
            document.getElementById('phosphorus').value = '';
            document.getElementById('potassium').value = '';
            document.getElementById('sulfur').value = '';
            return;
        }

        try {
            const data = await API.calculateNeed(cropId, yieldValue);
            
            // Extrahera need från API-svaret
            const need = data.need || data;
            
            // Populera NPKS-fälten med avrundade heltal
            document.getElementById('nitrogen').value = need.N ? Math.round(need.N) : '';
            document.getElementById('phosphorus').value = need.P ? Math.round(need.P) : '';
            document.getElementById('potassium').value = need.K ? Math.round(need.K) : '';
            document.getElementById('sulfur').value = need.S ? Math.round(need.S) : '';
        } catch (error) {
            console.error('❌ Kunde inte beräkna näringsbehov:', error);
        }
    },

    /**
     * Beräkna justerat näringsbehov för avancerad flik (minus ingående balans)
     */
    async calculateAdvancedNutrientNeed() {
        const cropId = document.getElementById('advCrop').value;
        const yieldValue = parseFloat(document.getElementById('advYield').value);

        // Om gröda eller skörd saknas, töm näringsbehovsfälten
        if (!cropId || !yieldValue || yieldValue <= 0) {
            document.getElementById('advNitrogen').value = '';
            document.getElementById('advPhosphorus').value = '';
            document.getElementById('advPotassium').value = '';
            document.getElementById('advSulfur').value = '';
            return;
        }

        try {
            const data = await API.calculateNeed(cropId, yieldValue);
            
            // Extrahera need från API-svaret
            const need = data.need || data;
            
            const balance = AppState.nutrientBalance || { N: 0, P: 0, K: 0, S: 0 };
            
            // Justera behov baserat på ingående balans
            // Positivt balans = mindre behov, negativt balans = mer behov
            const adjustedN = Math.max(0, (need.N || 0) - balance.N);
            const adjustedP = Math.max(0, (need.P || 0) - balance.P);
            const adjustedK = Math.max(0, (need.K || 0) - balance.K);
            const adjustedS = Math.max(0, (need.S || 0) - balance.S);


            // Populera justerade fälten med avrundade heltal
            document.getElementById('advNitrogen').value = Math.round(adjustedN);
            document.getElementById('advPhosphorus').value = Math.round(adjustedP);
            document.getElementById('advPotassium').value = Math.round(adjustedK);
            document.getElementById('advSulfur').value = Math.round(adjustedS);
        } catch (error) {
            console.error('❌ Kunde inte beräkna justerat näringsbehov:', error);
        }
    },

    /**
     * Hantera enkel form submit
     */
    async handleBasicFormSubmit(e) {
        e.preventDefault();

        // Förhindra dubbelklick
        if (this.isCalculating) {
            console.log('[Forms] Beräkning pågår redan, ignorerar');
            return;
        }
        this.isCalculating = true;

        // Samla in data
        const need = {};
        const n = parseFloat(document.getElementById('nitrogen').value);
        const p = parseFloat(document.getElementById('phosphorus').value);
        const k = parseFloat(document.getElementById('potassium').value);
        const s = parseFloat(document.getElementById('sulfur').value);

        if (n) need.N = n;
        if (p) need.P = p;
        if (k) need.K = k;
        if (s) need.S = s;

        // Validera att minst ett näringsämne finns
        if (Object.keys(need).length === 0) {
            this.showError('Ange minst ett näringsämne!');
            return;
        }

        const strategy = 'optimized'; // Alltid optimerad strategi
        const maxProducts = parseInt(document.getElementById('maxProducts').value);
        const topN = 5; // Visa topp 5 rekommendationer (3 med medaljer)

        // Läs vilka näringsämnen som måste uppnås
        let requiredNutrients = [];
        if (document.getElementById('requireN').checked) requiredNutrients.push('N');
        if (document.getElementById('requireP').checked) requiredNutrients.push('P');
        if (document.getElementById('requireK').checked) requiredNutrients.push('K');
        if (document.getElementById('requireS').checked) requiredNutrients.push('S');

        await this.fetchRecommendations(need, strategy, maxProducts, topN, requiredNutrients.length > 0 ? requiredNutrients : undefined);
    },

    /**
     * Hantera avancerad form submit
     */
    async handleAdvancedFormSubmit(e) {
        e.preventDefault();

        // Förhindra dubbla beräkningar
        if (this.isCalculating) {
            console.log('[Forms] Beräkning pågår redan, ignorerar');
            return;
        }
        this.isCalculating = true;

        // Samla in data från justerade fälten
        const need = {};
        const n = parseFloat(document.getElementById('advNitrogen').value);
        const p = parseFloat(document.getElementById('advPhosphorus').value);
        const k = parseFloat(document.getElementById('advPotassium').value);
        const s = parseFloat(document.getElementById('advSulfur').value);

        if (n) need.N = n;
        if (p) need.P = p;
        if (k) need.K = k;
        if (s) need.S = s;

        // Validera
        if (Object.keys(need).length === 0) {
            this.showError('Beräkna näringsbalans och välj gröda först!');
            return;
        }

        const strategy = 'optimized'; // Alltid optimerad strategi
        const maxProducts = parseInt(document.getElementById('advMaxProducts').value);
        const topN = 5; // Visa topp 5 rekommendationer (3 med medaljer)

        // Läs vilka näringsämnen som måste uppnås
        let requiredNutrients = [];
        if (document.getElementById('advRequireN').checked) requiredNutrients.push('N');
        if (document.getElementById('advRequireP').checked) requiredNutrients.push('P');
        if (document.getElementById('advRequireK').checked) requiredNutrients.push('K');
        if (document.getElementById('advRequireS').checked) requiredNutrients.push('S');

        await this.fetchRecommendations(need, strategy, maxProducts, topN, requiredNutrients.length > 0 ? requiredNutrients : undefined);
    },

    /**
     * Räkna antal produkter som är relevanta för valda näringsämnen
     * @param {string[]} requiredNutrients - Lista av näringsämnen (t.ex. ['N', 'P', 'K'])
     * @returns {number} Antal relevanta produkter (ej exkluderade, har minst ett valt näringsämne)
     */
    countRelevantProducts(requiredNutrients) {
        if (!AppState.products) return 0;
        
        const excludedSet = new Set(AppState.excludedProductIds || []);
        
        // Om inga specifika näringsämnen valda, räkna alla icke-exkluderade
        if (!requiredNutrients || requiredNutrients.length === 0) {
            return AppState.products.filter(p => !excludedSet.has(p.id)).length;
        }
        
        // Räkna produkter som har minst ett av de valda näringsämnena
        return AppState.products.filter(p => {
            if (excludedSet.has(p.id)) return false;
            if (!p.nutrients) return false;
            
            // Produkten måste ha minst ett av de valda näringsämnena > 0
            return requiredNutrients.some(nutrient => (p.nutrients[nutrient] || 0) > 0);
        }).length;
    },

    /**
     * Beräkna antal möjliga kombinationer (C(n,1) + C(n,2) + ... + C(n,k))
     * @param {number} n - Antal produkter
     * @param {number} k - Max antal produkter per kombination
     * @returns {number} Totalt antal kombinationer
     */
    calculateCombinations(n, k) {
        // Binomialkoefficient C(n, r) = n! / (r! * (n-r)!)
        const binomial = (n, r) => {
            if (r > n) return 0;
            if (r === 0 || r === n) return 1;
            let result = 1;
            for (let i = 0; i < r; i++) {
                result = result * (n - i) / (i + 1);
            }
            return Math.round(result);
        };

        let total = 0;
        for (let i = 1; i <= k; i++) {
            total += binomial(n, i);
        }
        return total;
    },

    /**
     * Hämta rekommendationer från API
     */
    async fetchRecommendations(need, strategy, maxProducts, topN, requiredNutrients) {
        try {
            const results = document.getElementById('results');
            const loading = document.getElementById('loading');
            const errorDiv = document.getElementById('error');

            // 1. RENSA gamla resultat och fel DIREKT (bara solutionsList, inte hela results)
            const solutionsList = document.getElementById('solutionsList');
            if (solutionsList) solutionsList.innerHTML = '';
            if (errorDiv) errorDiv.classList.remove('show');
            if (results) results.classList.remove('show');
            AppState.currentResultsData = null;

            // Beräkna antal kombinationer baserat på relevanta produkter
            const numProducts = this.countRelevantProducts(requiredNutrients);
            const combinations = this.calculateCombinations(numProducts, maxProducts);

            // 2. Återställ loader och starta intro-animation
            if (typeof spreaderLoader !== 'undefined' && spreaderLoader) {
                try {
                    spreaderLoader.reset();
                } catch (e) {
                    console.error('[Forms] reset() FEL:', e);
                }
                
                try {
                    spreaderLoader.showIntro(combinations);
                } catch (e) {
                    console.error('[Forms] showIntro() FEL:', e);
                }
            }
            
            // Den gamla loading-diven används inte längre - SpreaderLoader hanterar allt

            // 3. Kör API-anrop
            const apiPromise = API.getRecommendations(need, strategy, maxProducts, topN, requiredNutrients);
            
            // Vänta på API-svar
            const data = await apiPromise;
            
            // 4. Vänta tills intro är klar (minst 3 sek från start)
            if (typeof spreaderLoader !== 'undefined' && spreaderLoader) {
                try {
                    await spreaderLoader.waitForIntro();
                } catch (e) {
                    console.error('[Forms] waitForIntro() FEL:', e);
                }
            }
            
            // 5. Visa resultat (bakom blur)
            this.displayResults(data);
            
            // Scrolla så resultat #1 ligger längst upp
            if (results) {
                results.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
            
            // 6. Starta spreader-animation
            if (typeof spreaderLoader !== 'undefined' && spreaderLoader) {
                try {
                    spreaderLoader.startSpreader();
                } catch (e) {
                    console.error('[Forms] startSpreader() FEL:', e);
                }
            }
            
            // 7. Vänta på hide
            if (typeof spreaderLoader !== 'undefined' && spreaderLoader) {
                try {
                    await spreaderLoader.hide();
                } catch (e) {
                    console.error('[Forms] hide() FEL:', e);
                }
            }
            
            this.isCalculating = false;
            
        } catch (error) {
            console.error('[Forms] KRITISKT FEL i fetchRecommendations:', error);
            
            this.isCalculating = false;
            
            // Vid fel, avbryt intro och visa fel
            if (typeof spreaderLoader !== 'undefined' && spreaderLoader) {
                try {
                    spreaderLoader.cancelIntro();
                } catch (e) {
                    console.error('[Forms] cancelIntro() FEL:', e);
                }
            }
            this.showError(error.message);
        }
    },

    /**
     * Visa felmeddelande
     */
    showError(message) {
        const errorDiv = document.getElementById('error');
        errorDiv.textContent = '❌ ' + message;
        errorDiv.classList.add('show');
    },

    /**
     * Visa resultat
     */
    displayResults(data) {
        if (data.solutions.length === 0) {
            this.showError('Inga lösningar hittades. Försök ändra dina kriterier.');
            return;
        }

        // Rendera lösningar (redan optimalt sorterade från backend)
        this.renderSolutions(data);

        document.getElementById('results').classList.add('show');
    },

    /**
     * Rendera lösningar
     */
    renderSolutions(data) {
        const solutionsList = document.getElementById('solutionsList');
        solutionsList.innerHTML = '';
        
        data.solutions.forEach((solution, index) => {
            const card = this.createSolutionCard(solution, index + 1, data.need);
            solutionsList.appendChild(card);
        });
    },

    /**
     * Skapa lösningskort
     */
    createSolutionCard(solution, rank, need, requiredNutrients = ['N', 'P', 'K', 'S']) {
        const card = document.createElement('div');
        card.className = 'solution-card';
        
        // Lägg till medal-class för topp 3
        if (rank === 1) card.classList.add('medal-gold');
        else if (rank === 2) card.classList.add('medal-silver');
        else if (rank === 3) card.classList.add('medal-bronze');

        // Medalj emoji för topp 3
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';

        // Skapa header med rank, kostnad och knapp
        const header = document.createElement('div');
        header.className = 'solution-header';
        
        // Rank
        const rankDiv = document.createElement('div');
        rankDiv.className = 'solution-rank';
        rankDiv.textContent = `${medal} ${rank}`;
        
        // Kostnad
        const costDiv = document.createElement('div');
        costDiv.className = 'solution-cost';
        costDiv.textContent = `${solution.costPerHa.toFixed(0)} kr/ha`;
        
        // Knapp för att lägga till i inköpslista (kompakt i headern)
        const addButton = document.createElement('button');
        addButton.className = 'btn-add-to-list';
        addButton.innerHTML = '➕ Lägg till';
        addButton.onclick = (e) => {
            e.stopPropagation();
            PurchaseList.addItem(solution);
        };
        
        header.appendChild(rankDiv);
        header.appendChild(costDiv);
        header.appendChild(addButton);
        card.appendChild(header);

        // Produkter
        const products = document.createElement('div');
        products.className = 'products';
        products.innerHTML = '<strong>Produkter:</strong>';
        solution.products.forEach(prod => {
            const item = document.createElement('div');
            item.className = 'product-item';
            item.innerHTML = `
                <span>${prod.name}</span>
                <strong>${prod.kgPerHa} kg/ha</strong>
            `;
            products.appendChild(item);
        });
        card.appendChild(products);

        // Näringsämnen
        const nutrients = document.createElement('div');
        nutrients.className = 'nutrient-grid';
        ['N', 'P', 'K', 'S'].forEach(nutrient => {
            if (need[nutrient]) {
                const box = this.createNutrientBox(
                    nutrient,
                    solution.supplied[nutrient] || 0,
                    solution.deviation[nutrient],
                    need[nutrient]
                );
                nutrients.appendChild(box);
            }
        });
        card.appendChild(nutrients);

        // Knappen finns nu i headern, inte här längre

        return card;
    },

    /**
     * Skapa näringsämne-box
     */
    createNutrientBox(nutrient, supplied, deviation, need) {
        const box = document.createElement('div');
        box.className = 'nutrient-box';

        let deviationClass = 'deviation-good';
        let icon = '✓';
        let deviationText = '';
        
        if (deviation) {
            const pct = deviation.pct;
            
            // Bestäm färg och ikon baserat på avvikelse
            // GRÖNT: -5% till +15% (bra marginal)
            // GULT: -15% till -5% ELLER +15% till +30% (acceptabelt)
            // RÖTT: under -15% eller över +30% (problematiskt)
            
            if (pct < -15) {
                // Mycket för lite
                deviationClass = 'deviation-bad';
                icon = '⚠️';
                deviationText = `${pct.toFixed(1)}%`;
            } else if (pct < -5) {
                // Lite för lite
                deviationClass = 'deviation-warning';
                icon = '⚠';
                deviationText = `${pct.toFixed(1)}%`;
            } else if (pct <= 15) {
                // Perfekt intervall: -5% till +15%
                deviationClass = 'deviation-good';
                icon = '✓';
                deviationText = pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
            } else if (pct <= 30) {
                // Lite för mycket
                deviationClass = 'deviation-warning';
                icon = '↑';
                deviationText = `+${pct.toFixed(1)}%`;
            } else {
                // Mycket för mycket
                deviationClass = 'deviation-bad';
                icon = '⚠️';
                deviationText = `+${pct.toFixed(1)}%`;
            }
        }

        box.innerHTML = `
            <div class="nutrient-label">${nutrient}</div>
            <div class="nutrient-value">${Math.round(supplied)} <small style="color: #999;">/ ${Math.round(need)}</small></div>
            <div class="nutrient-deviation ${deviationClass}">
                ${deviation ? `<span style="font-size: 14px;">${icon}</span> ${deviationText}` : '-'}
            </div>
        `;

        return box;
    },

    /**
     * Initiera formulärhantering
     */
    init() {
        // Skapa debounced versioner av beräkningsfunktioner (väntar 400ms efter sista tangenttryckning)
        this.debouncedCalculateNutrientNeed = Utils.debounce(() => this.calculateNutrientNeed(), 400);
        this.debouncedCalculateAdvancedNutrientNeed = Utils.debounce(() => this.calculateAdvancedNutrientNeed(), 400);

        // Event listeners för formulär
        const basicForm = document.getElementById('nutrientForm');
        const advancedForm = document.getElementById('advancedForm');

        if (basicForm) {
            basicForm.addEventListener('submit', this.handleBasicFormSubmit.bind(this));
        }

        if (advancedForm) {
            advancedForm.addEventListener('submit', this.handleAdvancedFormSubmit.bind(this));
        }

        // Event listeners för auto-beräkning av näringsbehov
        const crop = document.getElementById('crop');
        const yieldInput = document.getElementById('yield');
        const advCrop = document.getElementById('advCrop');
        const advYield = document.getElementById('advYield');

        // Gröda-val triggar omedelbart (dropdown)
        if (crop) crop.addEventListener('change', () => this.calculateNutrientNeed());
        // Yield-input använder debounce för att vänta tills användaren slutat skriva
        if (yieldInput) yieldInput.addEventListener('input', () => this.debouncedCalculateNutrientNeed());
        
        // Samma för avancerad flik
        if (advCrop) advCrop.addEventListener('change', () => this.calculateAdvancedNutrientNeed());
        if (advYield) advYield.addEventListener('input', () => this.debouncedCalculateAdvancedNutrientNeed());

        console.log('✅ Formulärhantering initierad');
    }
};

// Exportera till window
window.Forms = Forms;

/**
 * FEST - Balance Module
 * Hantering av växtnäringsbalans (förfrukt och direkt inmatning)
 */

const Balance = {
    /**
     * Visa balansresultat i UI
     * @private
     */
    _displayBalance(N, P, K, S, showSign = false) {
        const formatValue = (val) => {
            if (showSign && val > 0) return '+' + val;
            return val.toFixed ? val.toFixed(1) : val;
        };

        document.getElementById('balanceN').textContent = formatValue(N);
        document.getElementById('balanceP').textContent = formatValue(P);
        document.getElementById('balanceK').textContent = formatValue(K);
        document.getElementById('balanceS').textContent = formatValue(S);
        document.getElementById('balanceResult').style.display = 'block';

        // Spara balansen för senare användning
        AppState.nutrientBalance = { N, P, K, S };
    },

    /**
     * Visa info om förfruktsvärde (tvåstegsmodell)
     * @private
     * @param {string} cropName - Namn på förfrukten
     * @param {number} nEffect - Kväveefterverkan (kg N/ha)
     * @param {number} yieldIncreaseKgHa - Skördeökning (kg/ha)
     * @param {number} yieldIncreaseNReq - Extra N-behov pga skördeökning (kg N/ha)
     */
    _showBalanceInfo(cropName, nEffect, yieldIncreaseKgHa = 0, yieldIncreaseNReq = 0) {
        const balanceInfo = document.getElementById('balanceInfo');
        
        // Netto N-effekt = kväveefterverkan minus extra N-behov för skördeökning
        const netNEffect = nEffect - yieldIncreaseNReq;
        
        // Bygg detaljerad info-text
        let infoHtml = '';
        
        if (nEffect > 0 || yieldIncreaseKgHa > 0) {
            // Förfrukt med positiv effekt
            infoHtml = `<div style="margin-bottom: 8px;">✨ <strong>${cropName}</strong> som förfrukt:</div>`;
            
            if (yieldIncreaseKgHa > 0) {
                infoHtml += `<div style="margin-left: 20px;">📈 Skördeökning: <strong>+${yieldIncreaseKgHa} kg/ha</strong> → kräver <strong>+${yieldIncreaseNReq} kg N/ha</strong></div>`;
            }
            
            if (nEffect > 0) {
                infoHtml += `<div style="margin-left: 20px;">🌱 Kväveefterverkan: <strong>−${nEffect} kg N/ha</strong> (tillgängligt från rötter/fixering)</div>`;
            }
            
            if (yieldIncreaseKgHa > 0 || nEffect > 0) {
                const sign = netNEffect >= 0 ? '+' : '';
                infoHtml += `<div style="margin-top: 8px; font-weight: 500;">📊 Nettoeffekt på N-behov: <strong>${sign}${Math.round(-netNEffect)} kg N/ha</strong></div>`;
            }
            
            balanceInfo.style.background = '#e8f5e9';
            balanceInfo.style.borderLeftColor = '#4CAF50';
            balanceInfo.style.color = '#2d5016';
        } else if (nEffect < 0) {
            // Negativt förfruktsvärde (rotfrukter, intensiva grödor)
            infoHtml = `⚠️ <strong>${cropName}</strong> ger negativt förfruktsvärde. Ca <strong>${nEffect} kg N/ha</strong> (kväve bundet i stubbar/organiskt material som inte är direkt tillgängligt).`;
            balanceInfo.style.background = '#fff9e6';
            balanceInfo.style.borderLeftColor = '#ffb300';
            balanceInfo.style.color = '#856404';
        } else {
            // Neutralt förfruktsvärde
            infoHtml = `ℹ️ <strong>${cropName}</strong> har neutralt förfruktsvärde (0 kg N/ha).`;
            balanceInfo.style.background = '#e3f2fd';
            balanceInfo.style.borderLeftColor = '#2196F3';
            balanceInfo.style.color = '#0d47a1';
        }
        
        balanceInfo.innerHTML = infoHtml;
        balanceInfo.style.display = 'block';
    },

    /**
     * Beräkna näringsbalans baserat på förfrukt (tvåstegsmodell)
     * 
     * Tvåstegsmodellen enligt Jordbruksverket 2025:
     * 1. Skördeökning kräver mer N: yieldEffect × 15 kg N/ton
     * 2. Kväveefterverkan tillför N: nEffect kg N/ha
     * Netto = nEffect - (yieldEffect/1000 × 15)
     * 
     * @param {boolean} showError - Om true, visa felmeddelande vid ofullständig input (default: true)
     */
    async calculateFromPreviousCrop(showError = true) {
        const previousCropId = document.getElementById('previousCrop').value;
        const previousYield = parseFloat(document.getElementById('previousYield').value);
        const prevN = parseFloat(document.getElementById('prevN').value) || 0;
        const prevP = parseFloat(document.getElementById('prevP').value) || 0;
        const prevK = parseFloat(document.getElementById('prevK').value) || 0;
        const prevS = parseFloat(document.getElementById('prevS').value) || 0;

        if (!previousCropId || !previousYield || previousYield <= 0) {
            // Visa bara fel om showError är true (t.ex. vid knapptryck)
            if (showError && window.Forms && typeof window.Forms.showError === 'function') {
                window.Forms.showError('Ange förfrukt och skörd för att beräkna balans');
            }
            return;
        }

        try {
            // Beräkna vad förfrukten tog upp
            const data = await API.calculateNeed(previousCropId, previousYield);

            if (data && data.success) {
                const uptake = data.need;
                
                // Hämta förfruktsvärde från crop-objektet
                const previousCrop = AppState.crops.find(c => c.id === previousCropId);
                const nEffect = previousCrop?.precropEffect?.nEffect || 0;
                const yieldEffectKgHa = previousCrop?.precropEffect?.yieldEffect || 0;
                
                // Beräkna extra N-behov pga skördeökning (15 kg N per ton)
                const yieldIncreaseNReq = (yieldEffectKgHa / 1000) * 15;
                
                // Netto förfruktseffekt = kväveefterverkan minus extra behov för skördeökning
                const netNEffect = nEffect - yieldIncreaseNReq;
                
                // Balans = tillförd gödsling - upptag av gröda + netto förfruktsvärde
                const balanceN = prevN - (uptake.N || 0) + netNEffect;
                const balanceP = prevP - (uptake.P || 0);
                const balanceK = prevK - (uptake.K || 0);
                const balanceS = prevS - (uptake.S || 0);

                // Visa resultat
                this._displayBalance(balanceN, balanceP, balanceK, balanceS);
                this._showBalanceInfo(
                    previousCrop ? previousCrop.name : '', 
                    nEffect, 
                    yieldEffectKgHa, 
                    yieldIncreaseNReq
                );

                console.log('📊 Näringsbalans (tvåstegsmodell):', {
                    nEffect,
                    yieldEffectKgHa,
                    yieldIncreaseNReq,
                    netNEffect,
                    balance: AppState.nutrientBalance
                });
            } else {
                if (window.Forms && typeof window.Forms.showError === 'function') {
                    window.Forms.showError('Fel vid beräkning: ' + (data?.error || 'Okänt fel'));
                }
            }
        } catch (error) {
            console.error('❌ Kunde inte beräkna balans:', error);
            if (window.Forms && typeof window.Forms.showError === 'function') {
                window.Forms.showError('Fel vid beräkning av näringsbalans');
            }
        }
    },

    /**
     * Använd direkt angiven näringsbalans från jordprov
     */
    useDirect() {
        const balanceN = parseFloat(document.getElementById('directBalanceN').value) || 0;
        const balanceP = parseFloat(document.getElementById('directBalanceP').value) || 0;
        const balanceK = parseFloat(document.getElementById('directBalanceK').value) || 0;
        const balanceS = parseFloat(document.getElementById('directBalanceS').value) || 0;

        // Visa resultat med +/- tecken
        this._displayBalance(balanceN, balanceP, balanceK, balanceS, true);
        document.getElementById('balanceInfo').style.display = 'none';

        console.log('📊 Näringsbalans angiven direkt:', AppState.nutrientBalance);
    }
};

// Exportera till window för HTML onclick-handlers
window.Balance = Balance;
window.calculateBalance = Balance.calculateFromPreviousCrop.bind(Balance);
window.useDirectBalance = Balance.useDirect.bind(Balance);

/**
 * Tab Management
 * Hantering av flikar och navigation
 */

const TabManager = {
    /**
     * Växla till inköpslista-fliken
     */
    switchTab(tabName) {
        if (tabName === 'purchase') {
            // Dölj basic och advanced tabs
            document.getElementById('basic-tab').classList.remove('active');
            document.getElementById('advanced-tab').classList.remove('active');
            document.getElementById('purchase-tab').classList.add('active');
            
            // Markera inköpslista-knappen som aktiv
            const purchaseBtn = document.querySelector('[onclick="switchTab(\'purchase\')"]');
            if (purchaseBtn) {
                purchaseBtn.classList.add('active');
            }
            
            // Dölj Enkel/Avancerad toggle, visa Tillbaka-knapp
            const toggleWrapper = document.getElementById('formModeToggleWrapper');
            const backBtn = document.getElementById('backToCalcBtn');
            if (toggleWrapper) toggleWrapper.style.display = 'none';
            if (backBtn) backBtn.style.display = 'flex';
            
            // Dölj resultat
            const resultsDiv = document.getElementById('results');
            if (resultsDiv) {
                resultsDiv.classList.remove('show');
            }
            
            // Rendera inköpslistan
            if (window.PurchaseList) {
                PurchaseList.render();
            }
        }
    },

    /**
     * Gå tillbaka till beräknings-läget (enkel eller avancerad beroende på toggle)
     */
    showCalculationTabs() {
        // Dölj inköpslistan
        document.getElementById('purchase-tab').classList.remove('active');
        
        // Ta bort active från inköpslista-knappen
        const purchaseBtn = document.querySelector('[onclick="switchTab(\'purchase\')"]');
        if (purchaseBtn) {
            purchaseBtn.classList.remove('active');
        }
        
        // Visa Enkel/Avancerad toggle, dölj Tillbaka-knapp
        const toggleWrapper = document.getElementById('formModeToggleWrapper');
        const backBtn = document.getElementById('backToCalcBtn');
        if (toggleWrapper) toggleWrapper.style.display = 'flex';
        if (backBtn) backBtn.style.display = 'none';
        
        // Visa rätt tab beroende på toggle-läge
        const toggle = document.getElementById('formModeToggle');
        if (toggle && toggle.classList.contains('active')) {
            document.getElementById('advanced-tab').classList.add('active');
        } else {
            document.getElementById('basic-tab').classList.add('active');
        }
    },

    /**
     * Växla mellan förfrukt och balans-läge
     */
    toggleBalanceMode() {
        const toggle = document.getElementById('balanceToggle');
        const forfruktSection = document.getElementById('forfrukt-section');
        const balanceSection = document.getElementById('balance-section');
        const labelForfrukt = document.getElementById('label-forfrukt');
        const labelBalance = document.getElementById('label-balance');
        const balanceInfo = document.getElementById('balanceInfo');
        const balanceResult = document.getElementById('balanceResult');
        
        // Toggle active state (lägg till/ta bort 'active' class)
        toggle.classList.toggle('active');
        
        // Kontrollera om toggle är active (växtnäringsbalans-läge)
        if (toggle.classList.contains('active')) {
            // Växtnäringsbalans-läge (direktinmatning)
            forfruktSection.style.display = 'none';
            balanceSection.style.display = 'block';
            labelForfrukt.classList.remove('active');
            labelBalance.classList.add('active');
            
            // Dölj ENDAST förfruktsvärde-info (inte hela resultatet)
            // Användaren kan fortfarande se siffror från tidigare beräkning
            if (balanceInfo) balanceInfo.style.display = 'none';
            
            // Dölj hela balansresultatet också - användaren ska klicka "Använd angiven balans"
            if (balanceResult) balanceResult.style.display = 'none';
            
            // Spara förfrukt-balansen för att kunna återställa vid toggling
            if (window.AppState && AppState.nutrientBalance) {
                AppState._forfruktBalanceBackup = { ...AppState.nutrientBalance };
            }
            
            // Rensa aktiv balans
            if (window.AppState) {
                AppState.nutrientBalance = null;
            }
        } else {
            // Förfrukt-läge (default)
            forfruktSection.style.display = 'block';
            balanceSection.style.display = 'none';
            labelForfrukt.classList.add('active');
            labelBalance.classList.remove('active');
            
            // Återställ förfrukt-balansen om den finns sparad
            if (window.AppState && AppState._forfruktBalanceBackup) {
                AppState.nutrientBalance = AppState._forfruktBalanceBackup;
                
                // Visa resultatet igen
                if (balanceResult) balanceResult.style.display = 'block';
                if (balanceInfo) balanceInfo.style.display = 'block';
                
                // Rensa backup
                delete AppState._forfruktBalanceBackup;
            }
        }
    },

    /**
     * Växla mellan Enkel och Avancerad flik
     */
    toggleFormMode() {
        const toggle = document.getElementById('formModeToggle');
        const basicTab = document.getElementById('basic-tab');
        const advancedTab = document.getElementById('advanced-tab');
        const labelBasic = document.getElementById('label-basic');
        const labelAdvanced = document.getElementById('label-advanced');
        
        // Toggle active state
        toggle.classList.toggle('active');
        
        // Kontrollera om toggle är active (avancerad-läge)
        if (toggle.classList.contains('active')) {
            // Avancerad-läge
            basicTab.classList.remove('active');
            advancedTab.classList.add('active');
            labelBasic.classList.remove('active');
            labelAdvanced.classList.add('active');
        } else {
            // Enkel-läge (default)
            basicTab.classList.add('active');
            advancedTab.classList.remove('active');
            labelBasic.classList.add('active');
            labelAdvanced.classList.remove('active');
        }
    }
};

window.TabManager = TabManager;
window.switchTab = TabManager.switchTab.bind(TabManager);
window.toggleBalanceMode = TabManager.toggleBalanceMode.bind(TabManager);
window.toggleFormMode = TabManager.toggleFormMode.bind(TabManager);


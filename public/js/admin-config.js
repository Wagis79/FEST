/**
 * Admin Configuration Page
 * Manages algorithm configuration parameters
 */

// State
let config = [];
let originalValues = {};
let modifiedValues = {};

// Admin password (from sessionStorage)
function getAdminPassword() {
    const session = sessionStorage.getItem('fest_admin_session');
    if (!session) return null;
    try {
        const parsed = JSON.parse(session);
        return parsed.password;
    } catch {
        return null;
    }
}

// Check session on load
function checkSession() {
    const password = getAdminPassword();
    if (!password) {
        window.location.href = '/admin.html';
        return false;
    }
    return true;
}

// Load configuration
async function loadConfig() {
    if (!checkSession()) return;

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <p>Laddar konfiguration...</p>
        </div>
    `;

    try {
        const response = await fetch('/api/admin/config', {
            headers: {
                'x-admin-password': getAdminPassword()
            }
        });

        if (!response.ok) {
            throw new Error('Kunde inte hämta konfiguration');
        }

        const data = await response.json();
        config = data.config;
        
        // Store original values
        originalValues = {};
        config.forEach(item => {
            originalValues[item.key] = item.value;
        });
        
        modifiedValues = {};
        
        renderConfig();
    } catch (error) {
        console.error('Error loading config:', error);
        mainContent.innerHTML = `
            <div class="loading">
                <p style="color: #f44336;">❌ ${error.message}</p>
                <button class="btn btn-primary" id="retryBtn" style="margin-top: 20px;">Försök igen</button>
            </div>
        `;
        // Attach event listener to retry button
        const retryBtn = document.getElementById('retryBtn');
        if (retryBtn) {
            retryBtn.addEventListener('click', loadConfig);
        }
    }
}

// Render configuration
function renderConfig() {
    const mainContent = document.getElementById('mainContent');
    
    // Group by category
    const categories = {
        tolerances: { icon: '📊', title: 'Toleranser & Constraints', items: [] },
        doses: { icon: '💊', title: 'Dosbegränsningar', items: [] },
        system: { icon: '🔧', title: 'Systembegränsningar', items: [] }
    };

    config.forEach(item => {
        const cat = categories[item.category] || categories.system;
        cat.items.push(item);
    });

    let html = '';

    for (const [catKey, cat] of Object.entries(categories)) {
        if (cat.items.length === 0) continue;

        html += `
            <div class="config-category">
                <div class="category-header">
                    <span class="category-icon">${cat.icon}</span>
                    <span class="category-title">${cat.title}</span>
                    <span class="category-badge">${cat.items.length} parametrar</span>
                </div>
                <div class="config-grid">
        `;

        for (const item of cat.items) {
            const isModified = modifiedValues.hasOwnProperty(item.key);
            const currentValue = isModified ? modifiedValues[item.key] : item.value;
            
            html += `
                <div class="config-item ${isModified ? 'modified' : ''}" id="item-${item.key}">
                    <div class="config-item-header">
                        <span class="config-key">${item.key}</span>
                        <span class="config-unit">${item.unit || ''}</span>
                    </div>
                    <p class="config-description">${item.description || ''}</p>
                    <div class="config-input-row">
                        <div class="config-input-group">
                            <input 
                                type="number" 
                                class="config-input ${isModified ? 'modified' : ''}"
                                id="input-${item.key}"
                                value="${currentValue}"
                                min="${item.min_value !== null ? item.min_value : ''}"
                                max="${item.max_value !== null ? item.max_value : ''}"
                                step="${item.unit === '%' ? '1' : '0.1'}"
                                data-config-key="${item.key}"
                            />
                        </div>
                        <span class="config-range">
                            ${item.min_value !== null ? item.min_value : '∞'} – ${item.max_value !== null ? item.max_value : '∞'}
                        </span>
                    </div>
                    <p class="config-original ${isModified ? '' : 'hidden'}" id="original-${item.key}">
                        Ursprungligt värde: ${item.value}
                    </p>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
    }

    mainContent.innerHTML = html;
    
    // Attach event listeners to all config inputs
    setupConfigInputListeners();
    
    updateStatusBar();
}

// Setup event listeners for dynamically created config inputs
function setupConfigInputListeners() {
    const inputs = document.querySelectorAll('.config-input[data-config-key]');
    inputs.forEach(input => {
        const key = input.dataset.configKey;
        input.addEventListener('change', () => handleInputChange(key, input.value));
        input.addEventListener('input', () => handleInputChange(key, input.value));
    });
}

// Handle input change
function handleInputChange(key, value) {
    const numValue = parseFloat(value);
    const originalValue = originalValues[key];
    
    if (numValue === originalValue) {
        delete modifiedValues[key];
    } else {
        modifiedValues[key] = numValue;
    }
    
    // Update UI
    const item = document.getElementById(`item-${key}`);
    const input = document.getElementById(`input-${key}`);
    const original = document.getElementById(`original-${key}`);
    
    if (modifiedValues.hasOwnProperty(key)) {
        item.classList.add('modified');
        input.classList.add('modified');
        original.classList.remove('hidden');
    } else {
        item.classList.remove('modified');
        input.classList.remove('modified');
        original.classList.add('hidden');
    }
    
    updateStatusBar();
}

// Update status bar
function updateStatusBar() {
    const statusBar = document.getElementById('statusBar');
    const changeCount = document.getElementById('changeCount');
    const count = Object.keys(modifiedValues).length;
    
    changeCount.textContent = `${count} ${count === 1 ? 'ändring' : 'ändringar'}`;
    
    if (count > 0) {
        statusBar.classList.add('visible');
    } else {
        statusBar.classList.remove('visible');
    }
}

// Reset changes
function resetChanges() {
    modifiedValues = {};
    renderConfig();
    showToast('Ändringar återställda', 'success');
}

// Save changes
async function saveChanges() {
    const updates = Object.entries(modifiedValues).map(([key, value]) => ({
        key,
        value
    }));

    if (updates.length === 0) {
        showToast('Inga ändringar att spara', 'error');
        return;
    }

    try {
        const response = await fetch('/api/admin/config/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-password': getAdminPassword()
            },
            body: JSON.stringify({ updates })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Kunde inte spara ändringar');
        }

        // Ladda om config från databasen för att säkerställa synkronisering
        modifiedValues = {};
        await loadConfig();
        
        showToast(`${updates.length} ${updates.length === 1 ? 'ändring sparad' : 'ändringar sparade'}`, 'success');
    } catch (error) {
        console.error('Error saving config:', error);
        showToast(error.message, 'error');
    }
}

// Toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} visible`;
    
    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

// Setup event listeners for static elements
function setupEventListeners() {
    // Reload button
    const reloadBtn = document.getElementById('reloadBtn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', loadConfig);
    }
    
    // Reset button
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetChanges);
    }
    
    // Save button
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveChanges);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadConfig();
});

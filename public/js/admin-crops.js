/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Crops Admin Panel JavaScript
 * Features: Search, Sort, Add/Edit/Delete crops
 * Security: Requires password from session
 */

const CropsAdmin = {
  crops: [],
  filteredCrops: [],
  currentSort: { column: null, direction: 'asc' },
  editingCrop: null,
  password: null,
  
  async init() {
    console.log('[CropsAdmin] Initializing...');
    
    // Registrera event listeners
    this.setupEventListeners();
    
    // Get password from session
    const SESSION_KEY = 'fest_admin_session';
    const session = sessionStorage.getItem(SESSION_KEY);
    
    if (session) {
      try {
        const data = JSON.parse(session);
        this.password = data.password;
      } catch {
        // Invalid session
      }
    }
    
    if (!this.password) {
      // Redirect to login
      window.location.href = '/admin.html';
      return;
    }
    
    await this.loadCrops();
  },
  
  setupEventListeners() {
    // Lägg till gröda-knapp
    const addBtn = document.getElementById('addCropBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.openAddModal());
    }
    
    // Sök-input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => this.handleSearch());
    }
    
    // Stäng modal-knapp (X)
    const closeBtn = document.getElementById('closeModalBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }
    
    // Avbryt-knapp i modal
    const cancelBtn = document.getElementById('cancelModalBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeModal());
    }
    
    // Formulär submit
    const form = document.getElementById('crop-form');
    if (form) {
      form.addEventListener('submit', (e) => this.handleSubmit(e));
    }
  },
  
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Admin-Password': this.password,
      'X-Requested-With': 'XMLHttpRequest'
    };
  },

  async loadCrops() {
    try {
      const response = await fetch('/api/admin/crops', {
        credentials: 'same-origin',
        headers: this.getHeaders()
      });
      
      if (response.status === 403) {
        alert('❌ Felaktigt lösenord!');
        this.password = null;
        sessionStorage.removeItem('adminPassword');
        await this.init();
        return;
      }
      
      if (!response.ok) {
        throw new Error('Kunde inte hämta grödor');
      }
      
      const data = await response.json();
      
      this.crops = data || [];
      this.filteredCrops = [...this.crops];
      
      console.log(`[CropsAdmin] Loaded ${this.crops.length} crops`);
      
      this.renderTable();
      this.updateStats();
    } catch (error) {
      console.error('[CropsAdmin] Error:', error);
      document.getElementById('crops-container').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <p>Kunde inte ladda grödor: ${error.message}</p>
        </div>
      `;
    }
  },

  getCategoryLabel(category) {
    const labels = {
      'spannmal': 'Spannmål',
      'oljevaxte': 'Oljeväxter',
      'grovfoder': 'Grovfoder',
      'rotfrukter': 'Rotfrukter',
      'ovriga': 'Övriga',
      // Fallback för engelska kategorier
      'grain': 'Spannmål',
      'oilseed': 'Oljeväxter',
      'legume': 'Baljväxter',
      'other': 'Övriga'
    };
    return labels[category] || category;
  },

  getCategoryClass(category) {
    // Mappa svenska kategorier till CSS-klasser
    const classMap = {
      'spannmal': 'grain',
      'oljevaxte': 'oilseed',
      'grovfoder': 'legume',
      'rotfrukter': 'other',
      'ovriga': 'other'
    };
    const cssClass = classMap[category] || category;
    return `category-${cssClass}`;
  },

  renderTable() {
    const container = document.getElementById('crops-container');
    
    if (this.filteredCrops.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🌾</div>
          <p>${this.crops.length === 0 ? 'Inga grödor hittades.' : 'Inga grödor matchade sökningen.'}</p>
        </div>
      `;
      return;
    }

    const html = `
      <div class="crops-table-container">
        <table class="crops-table">
          <thead>
            <tr>
              <th class="sortable" onclick="CropsAdmin.sortBy('id')">ID</th>
              <th class="sortable" onclick="CropsAdmin.sortBy('name')">Namn</th>
              <th class="sortable" onclick="CropsAdmin.sortBy('category')">Kategori</th>
              <th class="sortable" onclick="CropsAdmin.sortBy('n_per_ton')">N</th>
              <th class="sortable" onclick="CropsAdmin.sortBy('p_per_ton')">P</th>
              <th class="sortable" onclick="CropsAdmin.sortBy('k_per_ton')">K</th>
              <th class="sortable" onclick="CropsAdmin.sortBy('s_per_ton')">S</th>
              <th class="sortable" onclick="CropsAdmin.sortBy('yield_average')">Skörd (snitt)</th>
              <th class="sortable" onclick="CropsAdmin.sortBy('precrop_n_effect')">N-effekt</th>
              <th>Åtgärder</th>
            </tr>
          </thead>
          <tbody>
            ${this.filteredCrops.map(crop => this.renderRow(crop)).join('')}
          </tbody>
        </table>
      </div>
    `;
    
    container.innerHTML = html;
    this.updateSortIndicators();
  },

  renderRow(crop) {
    const categoryClass = this.getCategoryClass(crop.category);
    const categoryLabel = this.getCategoryLabel(crop.category);
    
    return `
      <tr>
        <td><code>${crop.id}</code></td>
        <td><strong>${crop.name}</strong></td>
        <td><span class="category-badge ${categoryClass}">${categoryLabel}</span></td>
        <td class="nutrient-cell">${crop.n_per_ton ?? '-'}</td>
        <td class="nutrient-cell">${crop.p_per_ton ?? '-'}</td>
        <td class="nutrient-cell">${crop.k_per_ton ?? '-'}</td>
        <td class="nutrient-cell">${crop.s_per_ton ?? '-'}</td>
        <td>${crop.yield_average} ton/ha</td>
        <td>${crop.precrop_n_effect > 0 ? '+' : ''}${crop.precrop_n_effect} kg</td>
        <td>
          <div class="table-actions">
            <button class="btn-icon btn-edit" onclick="CropsAdmin.openEditModal('${crop.id}')" title="Redigera">✏️</button>
            <button class="btn-icon btn-delete" onclick="CropsAdmin.deleteCrop('${crop.id}')" title="Ta bort">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  },

  updateStats() {
    const total = this.crops.length;
    const spannmal = this.crops.filter(c => c.category === 'spannmal').length;
    const oljevaxte = this.crops.filter(c => c.category === 'oljevaxte').length;
    const grovfoder = this.crops.filter(c => c.category === 'grovfoder').length;
    
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-spannmal').textContent = spannmal;
    document.getElementById('stat-oljevaxte').textContent = oljevaxte;
    document.getElementById('stat-grovfoder').textContent = grovfoder;
  },

  handleSearch() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();
    const category = document.getElementById('category-filter').value;
    
    this.filteredCrops = this.crops.filter(crop => {
      const matchesQuery = !query || 
        crop.name.toLowerCase().includes(query) ||
        crop.id.toLowerCase().includes(query);
      
      const matchesCategory = !category || crop.category === category;
      
      return matchesQuery && matchesCategory;
    });
    
    this.renderTable();
  },

  sortBy(column) {
    if (this.currentSort.column === column) {
      this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSort.column = column;
      this.currentSort.direction = 'asc';
    }

    this.filteredCrops.sort((a, b) => {
      let aVal = a[column];
      let bVal = b[column];
      
      if (aVal === null || aVal === undefined) aVal = '';
      if (bVal === null || bVal === undefined) bVal = '';
      
      // Try numeric comparison
      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);
      
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return this.currentSort.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }
      
      // String comparison
      const aStr = aVal.toString().toLowerCase();
      const bStr = bVal.toString().toLowerCase();
      
      if (this.currentSort.direction === 'asc') {
        return aStr.localeCompare(bStr, 'sv');
      } else {
        return bStr.localeCompare(aStr, 'sv');
      }
    });

    this.renderTable();
  },

  updateSortIndicators() {
    document.querySelectorAll('th.sortable').forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
    });
    
    if (this.currentSort.column) {
      const headers = document.querySelectorAll('th.sortable');
      headers.forEach(th => {
        // Match by onclick attribute content
        const onclick = th.getAttribute('onclick') || '';
        if (onclick.includes(`'${this.currentSort.column}'`)) {
          th.classList.add(this.currentSort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
      });
    }
  },

  openAddModal() {
    this.editingCrop = null;
    document.getElementById('modal-title').textContent = 'Lägg till gröda';
    document.getElementById('crop-form').reset();
    document.getElementById('crop-id').disabled = false;
    document.getElementById('crop-category').value = 'spannmal';
    document.getElementById('crop-unit').value = 'ton';
    document.getElementById('crop-source-provider').value = 'Jordbruksverket';
    document.getElementById('crop-modal').classList.add('active');
  },

  openEditModal(cropId) {
    const crop = this.crops.find(c => c.id === cropId);
    if (!crop) return;
    
    this.editingCrop = crop;
    document.getElementById('modal-title').textContent = 'Redigera gröda';
    
    // Fill form with crop data
    document.getElementById('crop-id').value = crop.id;
    document.getElementById('crop-id').disabled = true; // Can't change ID when editing
    document.getElementById('crop-name').value = crop.name;
    document.getElementById('crop-category').value = crop.category;
    document.getElementById('crop-unit').value = crop.unit;
    document.getElementById('crop-n').value = crop.n_per_ton;
    document.getElementById('crop-p').value = crop.p_per_ton;
    document.getElementById('crop-k').value = crop.k_per_ton;
    document.getElementById('crop-s').value = crop.s_per_ton || 0;
    document.getElementById('crop-yield-min').value = crop.yield_min;
    document.getElementById('crop-yield-max').value = crop.yield_max;
    document.getElementById('crop-yield-avg').value = crop.yield_average;
    document.getElementById('crop-precrop-n').value = crop.precrop_n_effect;
    document.getElementById('crop-precrop-yield').value = crop.precrop_yield_effect;
    document.getElementById('crop-description').value = crop.description || '';
    document.getElementById('crop-source-provider').value = crop.source_provider || 'Jordbruksverket';
    document.getElementById('crop-source-note').value = crop.source_note || '';
    
    document.getElementById('crop-modal').classList.add('active');
  },

  closeModal() {
    document.getElementById('crop-modal').classList.remove('active');
    document.getElementById('crop-id').disabled = false;
    this.editingCrop = null;
  },

  showAlert(message, type = 'info') {
    const alert = document.getElementById('alert');
    alert.textContent = message;
    alert.className = `alert alert-${type} active`;
    
    setTimeout(() => {
      alert.classList.remove('active');
    }, 5000);
  },

  async handleSubmit(event) {
    event.preventDefault();
    
    const cropData = {
      id: document.getElementById('crop-id').value.trim().toLowerCase(),
      name: document.getElementById('crop-name').value.trim(),
      category: document.getElementById('crop-category').value,
      unit: document.getElementById('crop-unit').value,
      n_per_ton: parseFloat(document.getElementById('crop-n').value) || 0,
      p_per_ton: parseFloat(document.getElementById('crop-p').value) || 0,
      k_per_ton: parseFloat(document.getElementById('crop-k').value) || 0,
      s_per_ton: parseFloat(document.getElementById('crop-s').value) || 0,
      yield_min: parseFloat(document.getElementById('crop-yield-min').value) || 0,
      yield_max: parseFloat(document.getElementById('crop-yield-max').value) || 0,
      yield_average: parseFloat(document.getElementById('crop-yield-avg').value) || 0,
      precrop_n_effect: parseInt(document.getElementById('crop-precrop-n').value) || 0,
      precrop_yield_effect: parseInt(document.getElementById('crop-precrop-yield').value) || 0,
      description: document.getElementById('crop-description').value.trim() || null,
      source_provider: document.getElementById('crop-source-provider').value,
      source_note: document.getElementById('crop-source-note').value.trim() || null,
    };

    // Validation
    if (!cropData.id || !cropData.name) {
      alert('ID och namn krävs!');
      return;
    }

    if (cropData.yield_min > cropData.yield_max) {
      alert('Minimum skörd kan inte vara högre än maximum!');
      return;
    }

    try {
      let response;
      if (this.editingCrop) {
        // Update existing crop
        response = await fetch(`/api/admin/crops/${cropData.id}`, {
          method: 'PUT',
          headers: this.getHeaders(),
          body: JSON.stringify(cropData)
        });
      } else {
        // Create new crop
        response = await fetch('/api/admin/crops', {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(cropData)
        });
      }

      if (response.ok) {
        this.showAlert(
          this.editingCrop ? '✅ Gröda uppdaterad!' : '✅ Gröda tillagd!',
          'success'
        );
        this.closeModal();
        await this.loadCrops();
      } else {
        const error = await response.json();
        alert('Fel: ' + (error.error || 'Kunde inte spara gröda'));
      }
    } catch (error) {
      alert('Fel: ' + error.message);
    }
  },

  async deleteCrop(cropId) {
    const crop = this.crops.find(c => c.id === cropId);
    if (!crop) return;
    
    if (!confirm(`Vill du verkligen ta bort grödan "${crop.name}"?`)) return;
    
    try {
      const response = await fetch(`/api/admin/crops/${cropId}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      
      if (response.ok) {
        this.showAlert('✅ Gröda borttagen!', 'success');
        await this.loadCrops();
      } else {
        const error = await response.json();
        alert('Fel: ' + (error.error || 'Kunde inte ta bort gröda'));
      }
    } catch (error) {
      alert('Fel: ' + error.message);
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  CropsAdmin.init();
});

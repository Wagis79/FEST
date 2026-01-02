/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Admin Panel JavaScript - Enhanced UI/UX
 * Features: Search, Sort, Add/Edit Modal
 * Security: Requires password from session
 */

const Admin = {
  products: [],
  filteredProducts: [],
  currentSort: { column: null, direction: 'asc' },
  editingProduct: null,
  password: null,
  
  async init() {
    console.log('[Admin] Initializing...');
    
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
    
    await this.loadProducts();
  },
  
  setupEventListeners() {
    // Lägg till produkt-knapp
    const addBtn = document.getElementById('addProductBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.openAddModal());
    }
    
    // Sök-input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('keyup', () => this.handleSearch());
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
    const form = document.getElementById('product-form');
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

  async loadProducts() {
    try {
      const response = await fetch('/api/admin/products', {
        credentials: 'same-origin',
        headers: this.getHeaders()
      });
      
      if (response.status === 403) {
        alert('❌ Felaktigt lösenord!');
        this.password = null;
        await this.init();
        return;
      }
      
      if (!response.ok) {
        throw new Error('Kunde inte hämta produkter');
      }
      
      const data = await response.json();
      
      this.products = data || [];
      this.filteredProducts = [...this.products];
      
      console.log(`[Admin] Loaded ${this.products.length} products`);
      
      this.renderTable();
      this.updateStats();
    } catch (error) {
      console.error('[Admin] Error:', error);
      document.getElementById('products-container').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <p>Kunde inte ladda produkter: ${error.message}</p>
        </div>
      `;
    }
  },

  renderTable() {
    const container = document.getElementById('products-container');
    
    if (this.filteredProducts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <p>${this.products.length === 0 ? 'Inga produkter hittades.' : 'Inga produkter matchade sökningen.'}</p>
        </div>
      `;
      return;
    }

    const html = `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th class="sortable" onclick="Admin.sortBy('Artikelnr')">Artikelnr</th>
              <th class="sortable" onclick="Admin.sortBy('Produkt')">Produkt</th>
              <th class="sortable" onclick="Admin.sortBy('active')">Status</th>
              <th class="sortable" onclick="Admin.sortBy('Optimeringsbar')">Opt.</th>
              <th class="sortable" onclick="Admin.sortBy('N')">N</th>
              <th class="sortable" onclick="Admin.sortBy('P')">P</th>
              <th class="sortable" onclick="Admin.sortBy('K')">K</th>
              <th class="sortable" onclick="Admin.sortBy('S')">S</th>
              <th class="sortable" onclick="Admin.sortBy('Ca')">Ca</th>
              <th class="sortable" onclick="Admin.sortBy('Mg')">Mg</th>
              <th class="sortable" onclick="Admin.sortBy('B')">B</th>
              <th class="sortable" onclick="Admin.sortBy('Cu')">Cu</th>
              <th class="sortable" onclick="Admin.sortBy('Mn')">Mn</th>
              <th class="sortable" onclick="Admin.sortBy('Zn')">Zn</th>
              <th class="sortable" onclick="Admin.sortBy('Övrigt')">Övrigt</th>
              <th class="sortable" onclick="Admin.sortBy('Produktklass')">Produktklass</th>
              <th class="sortable" onclick="Admin.sortBy('Pris')">Pris</th>
              <th>Åtgärder</th>
            </tr>
          </thead>
          <tbody>
            ${this.filteredProducts.map(p => this.renderRow(p)).join('')}
          </tbody>
        </table>
      </div>
    `;
    
    container.innerHTML = html;
    this.updateSortIndicators();
  },

  renderRow(product) {
    const isActive = product.active !== false;
    const statusBadge = isActive 
      ? '<span class="status-badge status-active">✅ Aktiv</span>'
      : '<span class="status-badge status-inactive">❌ Inaktiv</span>';
    
    const isOptimizable = product.Optimeringsbar === 'Ja';
    const optBadge = isOptimizable
      ? '<span class="status-badge status-active">✅</span>'
      : '<span class="status-badge status-inactive">❌</span>';
    
    return `
      <tr${!isActive ? ' style="opacity: 0.6;"' : ''}>
        <td>${product.Artikelnr || '-'}</td>
        <td><strong>${product.Produkt || '-'}</strong></td>
        <td>${statusBadge}</td>
        <td>${optBadge}</td>
        <td>${product.N || '-'}</td>
        <td>${product.P || '-'}</td>
        <td>${product.K || '-'}</td>
        <td>${product.S || '-'}</td>
        <td>${product.Ca || '-'}</td>
        <td>${product.Mg || '-'}</td>
        <td>${product.B || '-'}</td>
        <td>${product.Cu || '-'}</td>
        <td>${product.Mn || '-'}</td>
        <td>${product.Zn || '-'}</td>
        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${product.Övrigt || ''}">${product.Övrigt || '-'}</td>
        <td>${product.Produktklass || '-'}</td>
        <td><strong>${product.Pris || '-'}</strong> kr</td>
        <td>
          <div class="actions">
            <button class="btn-icon btn-edit" onclick="Admin.openEditModal(${product.Artikelnr})" title="Redigera">✏️</button>
            <button class="btn-icon btn-delete" onclick="Admin.deleteProduct(${product.Artikelnr})" title="Ta bort">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  },

  updateStats() {
    const activeCount = this.products.filter(p => p.active !== false).length;
    const inactiveCount = this.products.length - activeCount;
    const optimizableCount = this.products.filter(p => p.Optimeringsbar === 'Ja').length;
    const nonOptimizableCount = this.products.length - optimizableCount;
    
    const statsHTML = `
      <div class="stat-card">
        <div class="stat-number">${this.products.length}</div>
        <div class="stat-label">Totalt produkter</div>
      </div>
      <div class="stat-card" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%);">
        <div class="stat-number">${activeCount}</div>
        <div class="stat-label">Aktiva produkter</div>
      </div>
      <div class="stat-card" style="background: linear-gradient(135deg, #17a2b8 0%, #6f42c1 100%);">
        <div class="stat-number">${optimizableCount}</div>
        <div class="stat-label">Optimeringsbara</div>
      </div>
      <div class="stat-card" style="background: linear-gradient(135deg, #dc3545 0%, #fd7e14 100%);">
        <div class="stat-number">${inactiveCount}</div>
        <div class="stat-label">Inaktiva produkter</div>
      </div>
    `;
    
    document.getElementById('stats-container').innerHTML = statsHTML;
  },

  handleSearch() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();
    
    if (!query) {
      this.filteredProducts = [...this.products];
    } else {
      this.filteredProducts = this.products.filter(p => 
        (p.Produkt && p.Produkt.toLowerCase().includes(query)) ||
        (p.Artikelnr && p.Artikelnr.toString().includes(query)) ||
        (p.Produktklass && p.Produktklass.toLowerCase().includes(query))
      );
    }
    
    this.renderTable();
  },

  sortBy(column) {
    if (this.currentSort.column === column) {
      this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSort.column = column;
      this.currentSort.direction = 'asc';
    }

    this.filteredProducts.sort((a, b) => {
      let aVal = a[column];
      let bVal = b[column];
      
      if (!aVal && aVal !== 0) aVal = '';
      if (!bVal && bVal !== 0) bVal = '';
      
      const aNum = parseFloat(aVal.toString().replace(',', '.'));
      const bNum = parseFloat(bVal.toString().replace(',', '.'));
      
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return this.currentSort.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }
      
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
        if (th.textContent.trim() === this.currentSort.column) {
          th.classList.add(this.currentSort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
      });
    }
  },

  openAddModal() {
    this.editingProduct = null;
    document.getElementById('modal-title').textContent = 'Lägg till produkt';
    document.getElementById('product-form').reset();
    document.getElementById('optimeringsbar').value = 'Ja';
    document.getElementById('enhet').value = 'KG';
    document.getElementById('active').value = 'true';
    document.getElementById('product-modal').classList.add('active');
  },

  openEditModal(artikelnr) {
    const product = this.products.find(p => p.Artikelnr === artikelnr);
    if (!product) return;
    
    this.editingProduct = product;
    document.getElementById('modal-title').textContent = 'Redigera produkt';
    
    document.getElementById('artikelnr').value = product.Artikelnr || '';
    document.getElementById('produkt').value = product.Produkt || '';
    document.getElementById('active').value = product.active !== false ? 'true' : 'false';
    document.getElementById('n').value = product.N || '';
    document.getElementById('p').value = product.P || '';
    document.getElementById('k').value = product.K || '';
    document.getElementById('s').value = product.S || '';
    document.getElementById('ca').value = product.Ca || '';
    document.getElementById('mg').value = product.Mg || '';
    document.getElementById('b').value = product.B || '';
    document.getElementById('cu').value = product.Cu || '';
    document.getElementById('mn').value = product.Mn || '';
    document.getElementById('zn').value = product.Zn || '';
    document.getElementById('pris').value = product.Pris || '';
    document.getElementById('enhet').value = product.Enhet || 'KG';
    document.getElementById('produktklass').value = product.Produktklass || '';
    document.getElementById('optimeringsbar').value = product.Optimeringsbar === 'Ja' ? 'Ja' : 'Nej';
    document.getElementById('analysstatus').value = product.Analysstatus || '';
    document.getElementById('pallantal').value = product.PallAntal || '';
    document.getElementById('idx').value = product.idx || '';
    document.getElementById('ovrigt').value = product.Övrigt || '';
    
    document.getElementById('artikelnr').disabled = true;
    document.getElementById('product-modal').classList.add('active');
  },

  closeModal() {
    document.getElementById('product-modal').classList.remove('active');
    document.getElementById('artikelnr').disabled = false;
    this.editingProduct = null;
  },

  async handleSubmit(event) {
    event.preventDefault();
    
    const productData = {
      Artikelnr: parseInt(document.getElementById('artikelnr').value),
      Produkt: document.getElementById('produkt').value,
      active: document.getElementById('active').value === 'true',
      N: document.getElementById('n').value || '-',
      P: document.getElementById('p').value || '-',
      K: document.getElementById('k').value || '-',
      S: document.getElementById('s').value || '-',
      Ca: document.getElementById('ca').value || '-',
      Mg: document.getElementById('mg').value || '-',
      B: document.getElementById('b').value || '-',
      Cu: document.getElementById('cu').value || '-',
      Mn: document.getElementById('mn').value || '-',
      Zn: document.getElementById('zn').value || '-',
      Pris: document.getElementById('pris').value,
      Enhet: document.getElementById('enhet').value || 'KG',
      Produktklass: document.getElementById('produktklass').value || '',
      Optimeringsbar: document.getElementById('optimeringsbar').value,
      Analysstatus: document.getElementById('analysstatus').value || '',
      PallAntal: document.getElementById('pallantal').value || '',
      idx: document.getElementById('idx').value ? parseInt(document.getElementById('idx').value) : null,
      Övrigt: document.getElementById('ovrigt').value || '-'
    };

    try {
      let response;
      if (this.editingProduct) {
        response = await fetch(`/api/admin/products/prod-${productData.Artikelnr}`, {
          method: 'PUT',
          headers: this.getHeaders(),
          body: JSON.stringify(productData)
        });
      } else {
        response = await fetch('/api/admin/products', {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(productData)
        });
      }

      if (response.ok) {
        alert(this.editingProduct ? 'Produkt uppdaterad!' : 'Produkt tillagd!');
        this.closeModal();
        await this.loadProducts();
      } else {
        const error = await response.json();
        alert('Fel: ' + (error.error || 'Kunde inte spara produkt'));
      }
    } catch (error) {
      alert('Fel: ' + error.message);
    }
  },

  async deleteProduct(artikelnr) {
    if (!confirm(`Vill du verkligen ta bort produkt ${artikelnr}?`)) return;
    
    try {
      const response = await fetch(`/api/admin/products/prod-${artikelnr}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      
      if (response.ok) {
        alert('Produkt borttagen!');
        await this.loadProducts();
      } else {
        const error = await response.json();
        alert('Fel: ' + (error.error || 'Kunde inte ta bort produkt'));
      }
    } catch (error) {
      alert('Fel: ' + error.message);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Admin.init();
});

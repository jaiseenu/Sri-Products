/* ==========================================================================
   Sri Products — App
   Vanilla JS, hash-based router, no build step (this has to run as
   static files straight off GitHub Pages).
   ========================================================================== */

const App = (() => {
  const root = document.getElementById('app');
  const State = {
    items: null,       // cached list of active items
    customers: null,    // cached list of customers
    priceCache: {},      // itemId -> price history rows
    adjCache: {}          // itemId -> bottle adjustment rows
  };

  // ---------- utilities ----------

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function money(n) {
    const v = Number(n || 0);
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function todayInputValue() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function navigate(hash) { location.hash = hash; }

  // latest row whose EffectiveFrom <= target date, mirrors backend logic,
  // used only for a live preview — the server recomputes authoritatively.
  function latestEffective(rows, dateStr, valueKey) {
    const target = new Date(dateStr || todayInputValue());
    const applicable = rows.filter(r => new Date(r.EffectiveFrom) <= target)
      .sort((a, b) => new Date(b.EffectiveFrom) - new Date(a.EffectiveFrom));
    return applicable.length ? Number(applicable[0][valueKey]) : null;
  }

  async function ensureItems() {
    if (!State.items) State.items = await Api.call('listItems');
    return State.items;
  }
  async function ensureCustomers(search) {
    State.customers = await Api.call('listCustomers', { search: search || '' });
    return State.customers;
  }
  async function priceRowsFor(itemId) {
    if (!State.priceCache[itemId]) State.priceCache[itemId] = await Api.call('listPrices', { itemId });
    return State.priceCache[itemId];
  }
  async function adjRowsFor(itemId) {
    if (!State.adjCache[itemId]) State.adjCache[itemId] = await Api.call('listBottleAdjustments', { itemId });
    return State.adjCache[itemId];
  }

  // ---------- shell ----------

  function shell(title, bodyHtml, opts) {
    opts = opts || {};
    const back = opts.back !== false;
    const action = opts.actionLabel
      ? `<button class="top-action" id="topAction">${esc(opts.actionLabel)}</button>` : '';
    root.innerHTML = `
      <div class="top-bar">
        ${back ? '<button class="back-btn" id="backBtn">&#8592;</button>' : ''}
        <h1>${esc(title)}</h1>
        ${action}
      </div>
      <div class="screen">${bodyHtml}</div>
      <div id="tabBarHost"></div>
    `;
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.onclick = () => history.back();
    if (opts.onAction) {
      const a = document.getElementById('topAction');
      if (a) a.onclick = opts.onAction;
    }
    renderTabBar(opts.activeTab);
  }

  function renderTabBar(active) {
    const host = document.getElementById('tabBarHost');
    document.querySelectorAll('.tab-bar').forEach(el => el.remove());
    if (!Api.getToken()) return;
    const tabs = [
      { key: 'dashboard', label: 'Dashboard', icon: '&#8962;', hash: '#/dashboard' },
      { key: 'sales', label: 'Sales', icon: '&#128179;', hash: '#/sales' },
      { key: 'customers', label: 'Customers', icon: '&#128100;', hash: '#/customers' },
      { key: 'more', label: 'More', icon: '&#8942;', hash: '#/more' }
    ];
    const bar = document.createElement('div');
    bar.className = 'tab-bar';
    bar.innerHTML = tabs.map(t => `
      <button class="tab-btn ${active === t.key ? 'active' : ''}" data-hash="${t.hash}">
        <span class="tab-icon">${t.icon}</span>${t.label}
      </button>`).join('');
    bar.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => navigate(btn.dataset.hash);
    });
    document.body.appendChild(bar);
    if (host) host.remove(); // placeholder not needed once real bar is appended to body
  }

  function errorState(msg, retryHash) {
    return `<div class="empty-state">
      <div class="empty-title">Something went wrong</div>
      <p>${esc(msg)}</p>
    </div>`;
  }

  // ---------- LOGIN ----------

  function screenLogin() {
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-brand">
          <div class="brand-name">Sri Products</div>
          <div class="brand-motto">Quality never compromised</div>
        </div>
        <div class="login-card">
          <div class="field"><label>Username</label><input id="loginUser" autocomplete="username"></div>
          <div class="field"><label>Password</label><input id="loginPass" type="password" autocomplete="current-password"></div>
          <button class="btn btn-primary" id="loginBtn">Log in</button>
          <div class="login-error" id="loginErr" style="display:none"></div>
        </div>
      </div>`;
    document.getElementById('loginBtn').onclick = async () => {
      const username = document.getElementById('loginUser').value.trim();
      const password = document.getElementById('loginPass').value;
      const errEl = document.getElementById('loginErr');
      errEl.style.display = 'none';
      if (!username || !password) { errEl.textContent = 'Enter your username and password.'; errEl.style.display = 'block'; return; }
      try {
        const res = await Api.call('login', { username, password });
        Api.setToken(res.token);
        Api.setUser(res.user);
        navigate('#/dashboard');
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
      }
    };
  }

  // ---------- DASHBOARD ----------

  async function screenDashboard() {
    shell('Sri Products', `<div class="empty-state">Loading…</div>`, { back: false, activeTab: 'dashboard' });
    let d;
    try { d = await Api.call('getDashboard'); }
    catch (e) { document.querySelector('.screen').innerHTML = errorState(e.message); return; }

    const user = Api.getUser();
    const stockLow = d.currentStock.filter(s => s.currentStock <= 0);

    const body = `
      <p class="muted" style="margin-bottom:14px;">Hello, ${esc(user ? user.name : '')}</p>
      <div class="stat-grid">
        <div class="stat-tile"><div class="stat-label">Today's sales</div><div class="stat-value">${money(d.todaySalesTotal)}</div></div>
        <div class="stat-tile"><div class="stat-label">Today's payments</div><div class="stat-value">${money(d.todayPaymentsTotal)}</div></div>
        <div class="stat-tile"><div class="stat-label">This month</div><div class="stat-value">${money(d.monthSalesTotal)}</div></div>
        <div class="stat-tile"><div class="stat-label">Outstanding</div><div class="stat-value">${money(d.totalOutstanding)}</div></div>
      </div>

      <div class="section-label">Quick actions</div>
      <div class="quick-actions">
        <button class="quick-action" data-go="#/sales/new"><span class="qa-icon">&#128179;</span>New sale</button>
        <button class="quick-action" data-go="#/quotations/new"><span class="qa-icon">&#128221;</span>New quotation</button>
        <button class="quick-action" data-go="#/payments/new"><span class="qa-icon">&#128176;</span>Record payment</button>
        <button class="quick-action" data-go="#/production/new"><span class="qa-icon">&#9881;</span>New production</button>
      </div>

      ${stockLow.length ? `
      <div class="section-label">Stock at zero or below</div>
      <div class="panel">
        ${stockLow.map(s => `<div class="list-row"><div class="row-title">${esc(s.name)}</div><div class="amount red">${s.currentStock} ${esc(s.unit)}</div></div>`).join('')}
      </div>` : ''}

      <div class="section-label">Recent sales</div>
      <div class="panel">
        ${d.recentSales.length ? d.recentSales.map(s => `
          <div class="list-row" data-go="#/sales/${esc(s.SaleId)}">
            <div><div class="row-title">${esc(s.SaleId)}</div><div class="row-sub">${fmtDate(s.SaleDate)}</div></div>
            <div class="row-right"><div class="amount">${money(s.GrandTotal)}</div>${Number(s.Outstanding) > 0 ? `<div class="row-sub" style="color:var(--red-600)">${money(s.Outstanding)} due</div>` : ''}</div>
          </div>`).join('') : '<div class="empty-state">No sales yet.</div>'}
      </div>

      <div class="section-label">Recent payments</div>
      <div class="panel">
        ${d.recentPayments.length ? d.recentPayments.map(p => `
          <div class="list-row">
            <div><div class="row-title">${esc(p.PaymentId)}</div><div class="row-sub">${fmtDate(p.PaymentDate)} · ${esc(p.Method)}</div></div>
            <div class="amount green">${money(p.Amount)}</div>
          </div>`).join('') : '<div class="empty-state">No payments yet.</div>'}
      </div>
    `;
    document.querySelector('.screen').innerHTML = body;
    bindGoAttrs();
  }

  function bindGoAttrs() {
    document.querySelectorAll('[data-go]').forEach(el => {
      el.onclick = () => navigate(el.dataset.go);
    });
  }

  // ---------- MORE ----------

  function screenMore() {
    const user = Api.getUser();
    const isAdmin = user && user.role === 'Admin';
    shell('More', `
      <div class="section-label">Business</div>
      <div class="panel">
        <div class="list-row" data-go="#/quotations"><div class="row-title">Quotations</div><div>&#8250;</div></div>
        <div class="list-row" data-go="#/production"><div class="row-title">Production</div><div>&#8250;</div></div>
        <div class="list-row" data-go="#/inventory"><div class="row-title">Inventory</div><div>&#8250;</div></div>
      </div>
      ${isAdmin ? `
      <div class="section-label">Admin</div>
      <div class="panel">
        <div class="list-row" data-go="#/admin/products"><div class="row-title">Products</div><div>&#8250;</div></div>
        <div class="list-row" data-go="#/admin/prices"><div class="row-title">Price book</div><div>&#8250;</div></div>
        <div class="list-row" data-go="#/admin/bottle"><div class="row-title">Bottle adjustments</div><div>&#8250;</div></div>
        <div class="list-row" data-go="#/admin/settings"><div class="row-title">Business settings</div><div>&#8250;</div></div>
      </div>` : ''}
      <div class="section-label">Account</div>
      <div class="panel">
        <div class="list-row" id="logoutRow"><div class="row-title" style="color:var(--red-600)">Log out</div></div>
      </div>
    `, { back: false, activeTab: 'more' });
    bindGoAttrs();
    document.getElementById('logoutRow').onclick = () => {
      Api.setToken(null); Api.setUser(null); navigate('#/login');
    };
  }

  // ---------- CUSTOMERS ----------

  async function screenCustomers() {
    shell('Customers', `
      <div class="field"><input id="custSearch" placeholder="Search customers…"></div>
      <div class="panel" id="custList"><div class="empty-state">Loading…</div></div>
    `, { back: false, activeTab: 'customers', actionLabel: '+ New', onAction: () => navigate('#/customers/new') });

    async function load(search) {
      const list = document.getElementById('custList');
      try {
        const customers = await ensureCustomers(search);
        list.innerHTML = customers.length ? customers.map(c => `
          <div class="list-row" data-go="#/customers/${esc(c.CustomerId)}">
            <div><div class="row-title">${esc(c.Name)}</div><div class="row-sub">${esc(c.CustomerId)}</div></div>
            <div>&#8250;</div>
          </div>`).join('') : '<div class="empty-state">No customers found.</div>';
        bindGoAttrs();
      } catch (e) { list.innerHTML = errorState(e.message); }
    }
    load('');
    let t;
    document.getElementById('custSearch').oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(() => load(e.target.value), 250);
    };
  }

  function screenNewCustomer() {
    shell('New customer', `
      <div class="field"><label>Customer name</label><input id="custName" placeholder="e.g. Ramesh Traders"></div>
      <button class="btn btn-primary" id="saveCust">Save customer</button>
    `, { activeTab: 'customers' });
    document.getElementById('saveCust').onclick = async (e) => {
      const name = document.getElementById('custName').value.trim();
      if (!name) { toast('Enter a customer name.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        const c = await Api.call('createCustomer', { name });
        State.customers = null;
        toast('Customer added.');
        navigate('#/customers/' + c.CustomerId);
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Save customer'; }
    };
  }

  async function screenCustomerDetail(customerId) {
    shell('Customer', `<div class="empty-state">Loading…</div>`, { activeTab: 'customers' });
    let ledger;
    try { ledger = await Api.call('getCustomerLedger', { customerId }); }
    catch (e) { document.querySelector('.screen').innerHTML = errorState(e.message); return; }

    const customers = State.customers || await ensureCustomers('');
    const cust = customers.find(c => c.CustomerId === customerId) || { Name: customerId };

    document.querySelector('.top-bar h1').textContent = cust.Name;
    document.querySelector('.screen').innerHTML = `
      <div class="stat-grid">
        <div class="stat-tile"><div class="stat-label">Total sales</div><div class="stat-value">${money(ledger.totalSales)}</div></div>
        <div class="stat-tile"><div class="stat-label">Total paid</div><div class="stat-value">${money(ledger.totalPayments)}</div></div>
        <div class="stat-tile wide"><div class="stat-label">Outstanding</div><div class="stat-value">${money(ledger.outstanding)}</div></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary btn-sm" style="flex:1" data-go="#/sales/new?customer=${esc(customerId)}">New sale</button>
        <button class="btn btn-gold btn-sm" style="flex:1" data-go="#/customers/${esc(customerId)}/pay">Record payment</button>
      </div>

      <div class="section-label">Sales</div>
      <div class="panel">
        ${ledger.sales.length ? ledger.sales.map(s => `
          <div class="list-row" data-go="#/sales/${esc(s.SaleId)}">
            <div><div class="row-title">${esc(s.SaleId)}</div><div class="row-sub">${fmtDate(s.SaleDate)}</div></div>
            <div class="row-right"><div class="amount">${money(s.GrandTotal)}</div>${Number(s.Outstanding) > 0 ? `<div class="row-sub" style="color:var(--red-600)">${money(s.Outstanding)} due</div>` : ''}</div>
          </div>`).join('') : '<div class="empty-state">No sales yet.</div>'}
      </div>

      <div class="section-label">Payments</div>
      <div class="panel">
        ${ledger.payments.length ? ledger.payments.map(p => `
          <div class="list-row">
            <div><div class="row-title">${esc(p.PaymentId)}</div><div class="row-sub">${fmtDate(p.PaymentDate)} · ${esc(p.Method)}</div></div>
            <div class="amount green">${money(p.Amount)}</div>
          </div>`).join('') : '<div class="empty-state">No payments yet.</div>'}
      </div>
    `;
    bindGoAttrs();
  }

  // ---------- ITEM PICKER (shared by Sale / Quotation builders) ----------

  function lineItemTemplate(idx, items) {
    return `
      <div class="line-item" data-idx="${idx}">
        <div class="line-item-head">
          <span class="li-name">Item ${idx + 1}</span>
          <button class="li-remove" data-remove="${idx}">Remove</button>
        </div>
        <div class="field">
          <label>Product</label>
          <select class="li-item" data-idx="${idx}">
            <option value="">Select…</option>
            ${items.map(i => `<option value="${esc(i.ItemId)}">${esc(i.Name)} (${esc(i.Unit)})</option>`).join('')}
          </select>
        </div>
        <div class="line-item-row">
          <div class="field"><label>Quantity</label><input type="number" min="0" step="0.01" class="li-qty" data-idx="${idx}"></div>
        </div>
        <div class="checkbox-row"><input type="checkbox" class="li-bottle" data-idx="${idx}" id="bottle${idx}"><label for="bottle${idx}">Customer's own bottle</label></div>
        <div class="line-item-amount muted">Rate: <span class="li-rate">—</span> · Amount: <span class="li-amount">—</span></div>
      </div>`;
  }

  async function recalcLine(container, idx, dateStr) {
    const row = container.querySelector(`.line-item[data-idx="${idx}"]`);
    const itemId = row.querySelector('.li-item').value;
    const qty = Number(row.querySelector('.li-qty').value || 0);
    const ownBottle = row.querySelector('.li-bottle').checked;
    const rateEl = row.querySelector('.li-rate');
    const amtEl = row.querySelector('.li-amount');
    if (!itemId) { rateEl.textContent = '—'; amtEl.textContent = '—'; return null; }
    try {
      const prices = await priceRowsFor(itemId);
      const baseRate = latestEffective(prices, dateStr, 'Price');
      if (baseRate === null) { rateEl.textContent = 'no price set'; amtEl.textContent = '—'; return null; }
      let adj = 0;
      if (ownBottle) {
        const adjRows = await adjRowsFor(itemId);
        adj = latestEffective(adjRows, dateStr, 'Amount') || 0;
      }
      const finalRate = Math.round((baseRate - adj) * 100) / 100;
      const amount = Math.round(finalRate * qty * 100) / 100;
      rateEl.textContent = money(finalRate);
      amtEl.textContent = money(amount);
      return { itemId, quantity: qty, ownBottle, amount };
    } catch (e) {
      rateEl.textContent = 'error';
      return null;
    }
  }

  async function recalcTotals(container, dateStr, totalsEl) {
    const rows = container.querySelectorAll('.line-item');
    let subtotal = 0;
    for (const row of rows) {
      const idx = row.dataset.idx;
      const result = await recalcLine(container, Number(idx), dateStr);
      if (result) subtotal += result.amount;
    }
    totalsEl.innerHTML = `
      <div class="totals-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      <div class="totals-row grand"><span>Total</span><span>${money(subtotal)}</span></div>
      <p class="muted" style="color:#c7cbe0;margin-top:4px;">Tax (if GST is enabled) is calculated on save.</p>
    `;
  }

  function collectLineItems(container) {
    const rows = container.querySelectorAll('.line-item');
    const items = [];
    rows.forEach(row => {
      const itemId = row.querySelector('.li-item').value;
      const qty = Number(row.querySelector('.li-qty').value || 0);
      const ownBottle = row.querySelector('.li-bottle').checked;
      if (itemId && qty > 0) items.push({ itemId, quantity: qty, ownBottle });
    });
    return items;
  }

  // ---------- NEW SALE ----------

  async function screenNewSale(prefillCustomerId) {
    shell('New sale', `<div class="empty-state">Loading…</div>`, { activeTab: 'sales' });
    const items = await ensureItems();
    const customers = await ensureCustomers('');

    document.querySelector('.screen').innerHTML = `
      <div class="field">
        <label>Customer</label>
        <select id="saleCustomer">
          <option value="">Select customer…</option>
          ${customers.map(c => `<option value="${esc(c.CustomerId)}" ${c.CustomerId === prefillCustomerId ? 'selected' : ''}>${esc(c.Name)}</option>`).join('')}
        </select>
        <div class="hint"><a href="#/customers/new">+ Add a new customer</a> first if they're not listed.</div>
      </div>
      <div class="field"><label>Sale date</label><input type="date" id="saleDate" value="${todayInputValue()}"></div>

      <div class="section-label">Items</div>
      <div id="lineItems"></div>
      <button class="btn btn-secondary btn-sm" id="addLine">+ Add item</button>

      <div class="totals-panel" id="totals"></div>

      <div class="section-label">Payment</div>
      <div class="field"><label>Amount received now (optional)</label><input type="number" min="0" step="0.01" id="amountReceived" placeholder="0.00"></div>
      <div class="field">
        <label>Payment method</label>
        <select id="paymentMethod"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select>
      </div>

      <button class="btn btn-primary" id="saveSale" style="margin-top:8px;">Save sale</button>
    `;

    const lineHost = document.getElementById('lineItems');
    const totalsEl = document.getElementById('totals');
    let lineCount = 0;

    function addLine() {
      const idx = lineCount++;
      lineHost.insertAdjacentHTML('beforeend', lineItemTemplate(idx, items));
      bindLineEvents();
    }
    function bindLineEvents() {
      lineHost.querySelectorAll('.li-item, .li-qty, .li-bottle').forEach(el => {
        el.onchange = () => recalcTotals(lineHost, document.getElementById('saleDate').value, totalsEl);
      });
      lineHost.querySelectorAll('[data-remove]').forEach(btn => {
        btn.onclick = () => {
          lineHost.querySelector(`.line-item[data-idx="${btn.dataset.remove}"]`).remove();
          recalcTotals(lineHost, document.getElementById('saleDate').value, totalsEl);
        };
      });
    }
    document.getElementById('addLine').onclick = addLine;
    document.getElementById('saleDate').onchange = () => recalcTotals(lineHost, document.getElementById('saleDate').value, totalsEl);
    addLine();
    recalcTotals(lineHost, document.getElementById('saleDate').value, totalsEl);

    document.getElementById('saveSale').onclick = async (e) => {
      const customerId = document.getElementById('saleCustomer').value;
      if (!customerId) { toast('Select a customer.'); return; }
      const lineItemsPayload = collectLineItems(lineHost);
      if (lineItemsPayload.length === 0) { toast('Add at least one item.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        const res = await Api.call('createSale', {
          payload: {
            customerId, saleDate: document.getElementById('saleDate').value,
            items: lineItemsPayload,
            amountReceived: Number(document.getElementById('amountReceived').value || 0),
            paymentMethod: document.getElementById('paymentMethod').value
          }
        });
        toast('Sale saved.');
        navigate('#/sales/' + res.sale.SaleId);
      } catch (err) {
        toast(err.message);
        e.target.disabled = false; e.target.textContent = 'Save sale';
      }
    };
  }

  // ---------- SALES LIST / DETAIL ----------

  async function screenSales() {
    shell('Sales', `<div class="panel" id="salesList"><div class="empty-state">Loading…</div></div>`,
      { back: false, activeTab: 'sales', actionLabel: '+ New', onAction: () => navigate('#/sales/new') });
    try {
      const sales = await Api.call('listSales', {});
      const customers = await ensureCustomers('');
      const nameOf = id => { const c = customers.find(c => c.CustomerId === id); return c ? c.Name : id; };
      document.getElementById('salesList').innerHTML = sales.length ? sales.map(s => `
        <div class="list-row" data-go="#/sales/${esc(s.SaleId)}">
          <div><div class="row-title">${esc(nameOf(s.CustomerId))}</div><div class="row-sub">${esc(s.SaleId)} · ${fmtDate(s.SaleDate)}</div></div>
          <div class="row-right"><div class="amount">${money(s.GrandTotal)}</div>${Number(s.Outstanding) > 0 ? `<div class="row-sub" style="color:var(--red-600)">${money(s.Outstanding)} due</div>` : '<div class="row-sub" style="color:var(--green-700)">Paid</div>'}</div>
        </div>`).join('') : '<div class="empty-state"><div class="empty-title">No sales yet</div><p>Tap "+ New" to record your first sale.</p></div>';
      bindGoAttrs();
    } catch (e) { document.getElementById('salesList').innerHTML = errorState(e.message); }
  }

  async function screenSaleDetail(saleId) {
    shell('Sale', `<div class="empty-state">Loading…</div>`, { activeTab: 'sales' });
    let detail;
    try { detail = await Api.call('getSaleDetail', { saleId }); }
    catch (e) { document.querySelector('.screen').innerHTML = errorState(e.message); return; }
    const s = detail.sale;
    document.querySelector('.top-bar h1').textContent = s.SaleId;
    document.querySelector('.screen').innerHTML = `
      <div class="receipt-header">
        <div class="rh-name">Sri Products</div>
        <div class="rh-motto">Quality never compromised</div>
      </div>
      <div class="panel" style="padding:14px;">
        <p><strong>${esc(detail.customer ? detail.customer.Name : s.CustomerId)}</strong></p>
        <p class="muted">${esc(s.SaleId)} · ${fmtDate(s.SaleDate)}</p>
      </div>
      <div class="section-label">Items</div>
      <div class="panel">
        ${detail.items.map(i => `
          <div class="list-row">
            <div><div class="row-title">${esc(i.itemName)}</div><div class="row-sub">${i.Quantity} ${esc(i.Unit)} × ${money(i.FinalRate)}${Number(i.BottleAdjustment) > 0 ? ' (own bottle)' : ''}</div></div>
            <div class="amount">${money(i.Amount)}</div>
          </div>`).join('')}
      </div>
      <div class="totals-panel">
        <div class="totals-row"><span>Subtotal</span><span>${money(s.Subtotal)}</span></div>
        ${Number(s.TaxAmount) > 0 ? `<div class="totals-row"><span>Tax</span><span>${money(s.TaxAmount)}</span></div>` : ''}
        <div class="totals-row grand"><span>Total</span><span>${money(s.GrandTotal)}</span></div>
        <div class="totals-row"><span>Received</span><span>${money(s.AmountReceived)}</span></div>
        <div class="totals-row"><span>Outstanding</span><span>${money(s.Outstanding)}</span></div>
      </div>
      <div class="btn-row no-print">
        <button class="btn btn-secondary" id="printBtn">Print / Share PDF</button>
        ${Number(s.Outstanding) > 0 ? `<button class="btn btn-gold" data-go="#/customers/${esc(s.CustomerId)}/pay?sale=${esc(s.SaleId)}">Record payment</button>` : ''}
      </div>
    `;
    bindGoAttrs();
    document.getElementById('printBtn').onclick = () => window.print();
  }

  // ---------- PAYMENTS ----------

  async function screenRecordPayment(prefillCustomerId, prefillSaleId) {
    shell('Record payment', `<div class="empty-state">Loading…</div>`, { activeTab: 'customers' });
    const customers = await ensureCustomers('');
    document.querySelector('.screen').innerHTML = `
      <div class="field">
        <label>Customer</label>
        <select id="payCustomer">
          <option value="">Select customer…</option>
          ${customers.map(c => `<option value="${esc(c.CustomerId)}" ${c.CustomerId === prefillCustomerId ? 'selected' : ''}>${esc(c.Name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Amount</label><input type="number" min="0" step="0.01" id="payAmount"></div>
      <div class="field"><label>Date</label><input type="date" id="payDate" value="${todayInputValue()}"></div>
      <div class="field">
        <label>Method</label>
        <select id="payMethod"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select>
      </div>
      <div class="field"><label>Reference sale (optional)</label><input id="payRef" value="${esc(prefillSaleId || '')}" placeholder="e.g. SALE-000123"></div>
      <div class="field"><label>Notes (optional)</label><textarea id="payNotes" rows="2"></textarea></div>
      <button class="btn btn-primary" id="savePayment">Save payment</button>
    `;
    document.getElementById('savePayment').onclick = async (e) => {
      const customerId = document.getElementById('payCustomer').value;
      const amount = Number(document.getElementById('payAmount').value || 0);
      if (!customerId) { toast('Select a customer.'); return; }
      if (!(amount > 0)) { toast('Enter an amount greater than zero.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        await Api.call('recordPayment', {
          payload: {
            customerId, amount, paymentDate: document.getElementById('payDate').value,
            method: document.getElementById('payMethod').value,
            saleId: document.getElementById('payRef').value.trim(),
            notes: document.getElementById('payNotes').value.trim()
          }
        });
        toast('Payment recorded.');
        navigate('#/customers/' + customerId);
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Save payment'; }
    };
  }

  // ---------- QUOTATIONS ----------

  function statusBadge(status) {
    const cls = { Draft: 'badge-draft', Sent: 'badge-sent', Accepted: 'badge-accepted', Converted: 'badge-converted', Expired: 'badge-expired' }[status] || 'badge-draft';
    return `<span class="badge ${cls}">${esc(status)}</span>`;
  }

  async function screenQuotations() {
    shell('Quotations', `<div class="panel" id="quoteList"><div class="empty-state">Loading…</div></div>`,
      { activeTab: 'more', actionLabel: '+ New', onAction: () => navigate('#/quotations/new') });
    try {
      const quotes = await Api.call('listQuotations', {});
      const customers = await ensureCustomers('');
      const nameOf = id => { const c = customers.find(c => c.CustomerId === id); return c ? c.Name : id; };
      document.getElementById('quoteList').innerHTML = quotes.length ? quotes.map(q => `
        <div class="list-row" data-go="#/quotations/${esc(q.QuotationId)}">
          <div><div class="row-title">${esc(nameOf(q.CustomerId))}</div><div class="row-sub">${esc(q.QuotationId)} · ${fmtDate(q.QuotationDate)}</div></div>
          <div class="row-right"><div class="amount">${money(q.GrandTotal)}</div>${statusBadge(q.Status)}</div>
        </div>`).join('') : '<div class="empty-state"><div class="empty-title">No quotations yet</div></div>';
      bindGoAttrs();
    } catch (e) { document.getElementById('quoteList').innerHTML = errorState(e.message); }
  }

  async function screenNewQuotation() {
    shell('New quotation', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    const items = await ensureItems();
    const customers = await ensureCustomers('');
    document.querySelector('.screen').innerHTML = `
      <div class="field">
        <label>Customer</label>
        <select id="qCustomer"><option value="">Select customer…</option>${customers.map(c => `<option value="${esc(c.CustomerId)}">${esc(c.Name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Quotation date</label><input type="date" id="qDate" value="${todayInputValue()}"></div>
      <div class="field"><label>Valid until (optional)</label><input type="date" id="qValidUntil"></div>

      <div class="section-label">Items</div>
      <div id="qLineItems"></div>
      <button class="btn btn-secondary btn-sm" id="qAddLine">+ Add item</button>
      <div class="totals-panel" id="qTotals"></div>

      <button class="btn btn-primary" id="saveQuote" style="margin-top:14px;">Save quotation</button>
    `;
    const lineHost = document.getElementById('qLineItems');
    const totalsEl = document.getElementById('qTotals');
    let lineCount = 0;
    function addLine() {
      const idx = lineCount++;
      lineHost.insertAdjacentHTML('beforeend', lineItemTemplate(idx, items));
      lineHost.querySelectorAll('.li-item, .li-qty, .li-bottle').forEach(el => {
        el.onchange = () => recalcTotals(lineHost, document.getElementById('qDate').value, totalsEl);
      });
      lineHost.querySelectorAll('[data-remove]').forEach(btn => {
        btn.onclick = () => { lineHost.querySelector(`.line-item[data-idx="${btn.dataset.remove}"]`).remove(); recalcTotals(lineHost, document.getElementById('qDate').value, totalsEl); };
      });
    }
    document.getElementById('qAddLine').onclick = addLine;
    document.getElementById('qDate').onchange = () => recalcTotals(lineHost, document.getElementById('qDate').value, totalsEl);
    addLine();
    recalcTotals(lineHost, document.getElementById('qDate').value, totalsEl);

    document.getElementById('saveQuote').onclick = async (e) => {
      const customerId = document.getElementById('qCustomer').value;
      if (!customerId) { toast('Select a customer.'); return; }
      const lineItemsPayload = collectLineItems(lineHost);
      if (lineItemsPayload.length === 0) { toast('Add at least one item.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        const res = await Api.call('createQuotation', {
          payload: {
            customerId, quotationDate: document.getElementById('qDate').value,
            validUntil: document.getElementById('qValidUntil').value || null,
            items: lineItemsPayload
          }
        });
        toast('Quotation saved.');
        navigate('#/quotations/' + res.quotation.QuotationId);
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Save quotation'; }
    };
  }

  async function screenQuotationDetail(quotationId) {
    shell('Quotation', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    let detail;
    try { detail = await Api.call('getQuotationDetail', { quotationId }); }
    catch (e) { document.querySelector('.screen').innerHTML = errorState(e.message); return; }
    const q = detail.quotation;
    document.querySelector('.top-bar h1').textContent = q.QuotationId;
    document.querySelector('.screen').innerHTML = `
      <div class="panel" style="padding:14px;">
        <p><strong>${esc(detail.customer ? detail.customer.Name : q.CustomerId)}</strong> ${statusBadge(q.Status)}</p>
        <p class="muted">${fmtDate(q.QuotationDate)}${q.ValidUntil ? ' · valid until ' + fmtDate(q.ValidUntil) : ''}</p>
      </div>
      <div class="section-label">Items</div>
      <div class="panel">
        ${detail.items.map(i => `
          <div class="list-row">
            <div><div class="row-title">${esc(i.itemName)}</div><div class="row-sub">${i.Quantity} ${esc(i.Unit)} × ${money(i.FinalRate)}</div></div>
            <div class="amount">${money(i.Amount)}</div>
          </div>`).join('')}
      </div>
      <div class="totals-panel">
        <div class="totals-row"><span>Subtotal</span><span>${money(q.Subtotal)}</span></div>
        ${Number(q.TaxAmount) > 0 ? `<div class="totals-row"><span>Tax</span><span>${money(q.TaxAmount)}</span></div>` : ''}
        <div class="totals-row grand"><span>Total</span><span>${money(q.GrandTotal)}</span></div>
      </div>
      <div class="btn-row no-print">
        <button class="btn btn-secondary" id="printBtn">Print</button>
        ${(q.Status !== 'Converted' && q.Status !== 'Expired') ? `<button class="btn btn-gold" data-go="#/quotations/${esc(q.QuotationId)}/convert">Convert to sale</button>` : ''}
      </div>
    `;
    bindGoAttrs();
    document.getElementById('printBtn').onclick = () => window.print();
  }

  async function screenConvertQuotation(quotationId) {
    shell('Convert to sale', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    let detail;
    try { detail = await Api.call('getQuotationDetail', { quotationId }); }
    catch (e) { document.querySelector('.screen').innerHTML = errorState(e.message); return; }
    document.querySelector('.screen').innerHTML = `
      <p class="muted">Converting ${esc(quotationId)} for <strong>${esc(detail.customer ? detail.customer.Name : detail.quotation.CustomerId)}</strong>, total ${money(detail.quotation.GrandTotal)}.</p>
      <div class="field"><label>Amount received now (optional)</label><input type="number" min="0" step="0.01" id="convAmount"></div>
      <div class="field">
        <label>Payment method</label>
        <select id="convMethod"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select>
      </div>
      <button class="btn btn-primary" id="convertBtn">Confirm conversion</button>
    `;
    document.getElementById('convertBtn').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Converting…';
      try {
        const res = await Api.call('convertQuotationToSale', {
          quotationId, paymentAmount: Number(document.getElementById('convAmount').value || 0),
          paymentMethod: document.getElementById('convMethod').value
        });
        if (res.stockWarnings && res.stockWarnings.length) {
          toast('Converted — but stock ran short on: ' + res.stockWarnings.join('; '));
        } else {
          toast('Converted to sale.');
        }
        navigate('#/sales/' + res.sale.SaleId);
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Confirm conversion'; }
    };
  }

  // ---------- PRODUCTION ----------

  async function screenProduction() {
    shell('Production', `<div class="panel" id="prodList"><div class="empty-state">Loading…</div></div>`,
      { activeTab: 'more', actionLabel: '+ New', onAction: () => navigate('#/production/new') });
    try {
      const rows = await Api.call('listProduction');
      document.getElementById('prodList').innerHTML = rows.length ? rows.map(p => `
        <div class="list-row">
          <div>
            <div class="row-title">${fmtDate(p.date)}</div>
            <div class="row-sub">In: ${p.inputs.map(i => `${i.itemName} ${i.quantity}`).join(', ') || '—'}</div>
            <div class="row-sub">Out: ${p.outputs.map(o => `${o.itemName} ${o.quantity}`).join(', ') || '—'}</div>
          </div>
        </div>`).join('') : '<div class="empty-state"><div class="empty-title">No production entries yet</div></div>';
    } catch (e) { document.getElementById('prodList').innerHTML = errorState(e.message); }
  }

  function prodLineTemplate(idx, items, kind) {
    return `
      <div class="line-item" data-${kind}-idx="${idx}">
        <div class="line-item-head">
          <span class="li-name">${kind === 'input' ? 'Raw material' : 'Output'} ${idx + 1}</span>
          <button class="li-remove" data-remove-${kind}="${idx}">Remove</button>
        </div>
        <div class="field">
          <select class="p-${kind}-item">
            <option value="">Select item…</option>
            ${items.map(i => `<option value="${esc(i.ItemId)}">${esc(i.Name)} (${esc(i.Unit)})</option>`).join('')}
          </select>
        </div>
        <div class="field"><input type="number" min="0" step="0.01" class="p-${kind}-qty" placeholder="Quantity"></div>
      </div>`;
  }

  async function screenNewProduction() {
    shell('New production', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    const items = await ensureItems();
    document.querySelector('.screen').innerHTML = `
      <div class="field"><label>Date</label><input type="date" id="pDate" value="${todayInputValue()}"></div>
      <div class="field"><label>Notes (optional)</label><textarea id="pNotes" rows="2"></textarea></div>

      <div class="section-label">Raw materials consumed</div>
      <div id="pInputs"></div>
      <button class="btn btn-secondary btn-sm" id="addInput">+ Add input</button>

      <div class="section-label">Outputs produced</div>
      <div id="pOutputs"></div>
      <button class="btn btn-secondary btn-sm" id="addOutput">+ Add output</button>

      <button class="btn btn-primary" id="saveProd" style="margin-top:16px;">Save production entry</button>
    `;
    const inputHost = document.getElementById('pInputs');
    const outputHost = document.getElementById('pOutputs');
    let inCount = 0, outCount = 0;

    function addInput() {
      const idx = inCount++;
      inputHost.insertAdjacentHTML('beforeend', prodLineTemplate(idx, items, 'input'));
      inputHost.querySelector(`[data-remove-input="${idx}"]`).onclick = () => inputHost.querySelector(`[data-input-idx="${idx}"]`).remove();
    }
    function addOutput() {
      const idx = outCount++;
      outputHost.insertAdjacentHTML('beforeend', prodLineTemplate(idx, items, 'output'));
      outputHost.querySelector(`[data-remove-output="${idx}"]`).onclick = () => outputHost.querySelector(`[data-output-idx="${idx}"]`).remove();
    }
    document.getElementById('addInput').onclick = addInput;
    document.getElementById('addOutput').onclick = addOutput;
    addInput(); addOutput();

    document.getElementById('saveProd').onclick = async (e) => {
      const inputs = [];
      inputHost.querySelectorAll('[data-input-idx]').forEach(row => {
        const itemId = row.querySelector('.p-input-item').value;
        const qty = Number(row.querySelector('.p-input-qty').value || 0);
        if (itemId && qty > 0) inputs.push({ itemId, quantity: qty });
      });
      const outputs = [];
      outputHost.querySelectorAll('[data-output-idx]').forEach(row => {
        const itemId = row.querySelector('.p-output-item').value;
        const qty = Number(row.querySelector('.p-output-qty').value || 0);
        if (itemId && qty > 0) outputs.push({ itemId, quantity: qty });
      });
      if (!inputs.length || !outputs.length) { toast('Add at least one input and one output.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        await Api.call('createProduction', { payload: { date: document.getElementById('pDate').value, notes: document.getElementById('pNotes').value, inputs, outputs } });
        toast('Production entry saved.');
        navigate('#/production');
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Save production entry'; }
    };
  }

  // ---------- INVENTORY ----------

  async function screenInventory() {
    shell('Inventory', `<div class="panel" id="stockList"><div class="empty-state">Loading…</div></div>`, { activeTab: 'more' });
    try {
      const stock = await Api.call('getCurrentStock');
      document.getElementById('stockList').innerHTML = stock.length ? stock.map(s => `
        <div class="list-row" data-go="#/inventory/${esc(s.itemId)}">
          <div><div class="row-title">${esc(s.name)}</div><div class="row-sub">${esc(s.type)}</div></div>
          <div class="amount ${s.currentStock <= 0 ? 'red' : ''}">${s.currentStock} ${esc(s.unit)}</div>
        </div>`).join('') : '<div class="empty-state"><div class="empty-title">No items yet</div><p>Add products first under More &rsaquo; Admin &rsaquo; Products.</p></div>';
      bindGoAttrs();
    } catch (e) { document.getElementById('stockList').innerHTML = errorState(e.message); }
  }

  async function screenInventoryItem(itemId) {
    shell('Stock history', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    try {
      const [items, movements] = await Promise.all([ensureItems(), Api.call('getStockMovementHistory', { itemId })]);
      const item = items.find(i => i.ItemId === itemId) || { Name: itemId };
      document.querySelector('.top-bar h1').textContent = item.Name;
      const user = Api.getUser();
      document.querySelector('.screen').innerHTML = `
        ${user && user.role === 'Admin' ? `<button class="btn btn-secondary btn-sm" data-go="#/inventory/${esc(itemId)}/adjust">Adjust stock</button><div class="divider"></div>` : ''}
        <div class="panel">
          ${movements.length ? movements.map(m => `
            <div class="list-row">
              <div><div class="row-title">${esc(m.MovementType)}</div><div class="row-sub">${fmtDate(m.Date)}${m.Notes ? ' · ' + esc(m.Notes) : ''}</div></div>
              <div class="amount ${Number(m.Quantity) < 0 ? 'red' : 'green'}">${Number(m.Quantity) > 0 ? '+' : ''}${m.Quantity} ${esc(m.Unit)}</div>
            </div>`).join('') : '<div class="empty-state">No movements recorded yet.</div>'}
        </div>
      `;
      bindGoAttrs();
    } catch (e) { document.querySelector('.screen').innerHTML = errorState(e.message); }
  }

  async function screenAdjustStock(itemId) {
    shell('Adjust stock', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    const items = await ensureItems();
    const item = items.find(i => i.ItemId === itemId) || { Name: itemId, Unit: '' };
    document.querySelector('.screen').innerHTML = `
      <p class="muted">Adjusting <strong>${esc(item.Name)}</strong>. Use a positive number to add stock, negative to remove.</p>
      <div class="field"><label>Quantity (${esc(item.Unit)})</label><input type="number" step="0.01" id="adjQty"></div>
      <div class="field"><label>Reason</label><textarea id="adjReason" rows="2" placeholder="e.g. Physical count correction"></textarea></div>
      <button class="btn btn-primary" id="saveAdj">Save adjustment</button>
    `;
    document.getElementById('saveAdj').onclick = async (e) => {
      const qty = Number(document.getElementById('adjQty').value || 0);
      const reason = document.getElementById('adjReason').value.trim();
      if (!qty) { toast('Enter a non-zero quantity.'); return; }
      if (!reason) { toast('A reason is required.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        await Api.call('createStockAdjustment', { itemId, quantity: qty, reason });
        toast('Stock adjusted.');
        navigate('#/inventory/' + itemId);
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Save adjustment'; }
    };
  }

  // ---------- ADMIN: PRODUCTS ----------

  async function screenAdminProducts() {
    shell('Products', `<div class="panel" id="prodItemList"><div class="empty-state">Loading…</div></div>`,
      { activeTab: 'more', actionLabel: '+ New', onAction: () => navigate('#/admin/products/new') });
    try {
      State.items = null;
      const items = await ensureItems();
      document.getElementById('prodItemList').innerHTML = items.length ? items.map(i => `
        <div class="list-row">
          <div><div class="row-title">${esc(i.Name)}</div><div class="row-sub">${esc(i.Type)} · ${esc(i.Unit)}${Number(i.TaxRate) > 0 ? ' · ' + i.TaxRate + '% tax' : ''}</div></div>
        </div>`).join('') : '<div class="empty-state">No products yet.</div>';
    } catch (e) { document.getElementById('prodItemList').innerHTML = errorState(e.message); }
  }

  function screenNewProduct() {
    shell('New product', `
      <div class="field"><label>Name</label><input id="itemName" placeholder="e.g. Groundnut Oil"></div>
      <div class="field">
        <label>Type</label>
        <select id="itemType"><option value="RawMaterial">Raw material</option><option value="FinishedOil">Finished oil</option><option value="CakeByProduct">Cake by-product</option></select>
      </div>
      <div class="field">
        <label>Unit</label>
        <select id="itemUnit"><option value="L">Litres (L)</option><option value="Kg">Kilograms (Kg)</option></select>
      </div>
      <div class="field"><label>Tax rate % (used only when GST is enabled)</label><input type="number" min="0" step="0.01" id="itemTax" value="0"></div>
      <button class="btn btn-primary" id="saveItem">Save product</button>
    `, { activeTab: 'more' });
    document.getElementById('saveItem').onclick = async (e) => {
      const name = document.getElementById('itemName').value.trim();
      if (!name) { toast('Enter a product name.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        await Api.call('createItem', { item: { name, type: document.getElementById('itemType').value, unit: document.getElementById('itemUnit').value, taxRate: Number(document.getElementById('itemTax').value || 0) } });
        State.items = null;
        toast('Product added.');
        navigate('#/admin/products');
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Save product'; }
    };
  }

  // ---------- ADMIN: PRICE BOOK ----------

  async function screenAdminPrices() {
    shell('Price book', `<div class="panel" id="priceItemList"><div class="empty-state">Loading…</div></div>`, { activeTab: 'more' });
    const items = await ensureItems();
    document.getElementById('priceItemList').innerHTML = items.map(i => `
      <div class="list-row" data-go="#/admin/prices/${esc(i.ItemId)}"><div class="row-title">${esc(i.Name)}</div><div>&#8250;</div></div>
    `).join('') || '<div class="empty-state">Add products first.</div>';
    bindGoAttrs();
  }

  async function screenAdminPriceItem(itemId) {
    shell('Prices', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    const items = await ensureItems();
    const item = items.find(i => i.ItemId === itemId) || { Name: itemId };
    document.querySelector('.top-bar h1').textContent = item.Name;
    const rows = await Api.call('listPrices', { itemId });
    document.querySelector('.screen').innerHTML = `
      <div class="field"><label>New effective date</label><input type="date" id="newPriceDate" value="${todayInputValue()}"></div>
      <div class="field"><label>Price per ${esc(item.Unit || 'unit')}</label><input type="number" min="0" step="0.01" id="newPriceValue"></div>
      <button class="btn btn-primary" id="savePrice">Add price</button>
      <div class="section-label">History</div>
      <div class="panel">
        ${rows.length ? rows.map(r => `<div class="list-row"><div class="row-title">${fmtDate(r.EffectiveFrom)}</div><div class="amount">${money(r.Price)}</div></div>`).join('') : '<div class="empty-state">No prices set yet.</div>'}
      </div>
    `;
    document.getElementById('savePrice').onclick = async (e) => {
      const price = Number(document.getElementById('newPriceValue').value || 0);
      if (!(price > 0)) { toast('Enter a price greater than zero.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        await Api.call('addPrice', { itemId, effectiveFrom: document.getElementById('newPriceDate').value, price });
        delete State.priceCache[itemId];
        toast('Price added.');
        screenAdminPriceItem(itemId);
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Add price'; }
    };
  }

  // ---------- ADMIN: BOTTLE ADJUSTMENTS ----------

  async function screenAdminBottle() {
    shell('Bottle adjustments', `<div class="panel" id="bottleItemList"><div class="empty-state">Loading…</div></div>`, { activeTab: 'more' });
    const items = await ensureItems();
    document.getElementById('bottleItemList').innerHTML = items.map(i => `
      <div class="list-row" data-go="#/admin/bottle/${esc(i.ItemId)}"><div class="row-title">${esc(i.Name)}</div><div>&#8250;</div></div>
    `).join('') || '<div class="empty-state">Add products first.</div>';
    bindGoAttrs();
  }

  async function screenAdminBottleItem(itemId) {
    shell('Bottle adjustment', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    const items = await ensureItems();
    const item = items.find(i => i.ItemId === itemId) || { Name: itemId };
    document.querySelector('.top-bar h1').textContent = item.Name;
    const rows = await Api.call('listBottleAdjustments', { itemId });
    document.querySelector('.screen').innerHTML = `
      <p class="muted">Amount deducted per ${esc(item.Unit || 'unit')} when the customer supplies their own bottle.</p>
      <div class="field"><label>New effective date</label><input type="date" id="newAdjDate" value="${todayInputValue()}"></div>
      <div class="field"><label>Deduction amount</label><input type="number" min="0" step="0.01" id="newAdjValue"></div>
      <button class="btn btn-primary" id="saveAdj">Add adjustment</button>
      <div class="section-label">History</div>
      <div class="panel">
        ${rows.length ? rows.map(r => `<div class="list-row"><div class="row-title">${fmtDate(r.EffectiveFrom)}</div><div class="amount">${money(r.Amount)}</div></div>`).join('') : '<div class="empty-state">No adjustments set yet.</div>'}
      </div>
    `;
    document.getElementById('saveAdj').onclick = async (e) => {
      const amount = Number(document.getElementById('newAdjValue').value || 0);
      if (!(amount >= 0)) { toast('Enter a valid amount.'); return; }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        await Api.call('addBottleAdjustment', { itemId, effectiveFrom: document.getElementById('newAdjDate').value, amount });
        delete State.adjCache[itemId];
        toast('Adjustment added.');
        screenAdminBottleItem(itemId);
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Add adjustment'; }
    };
  }

  // ---------- ADMIN: SETTINGS ----------

  async function screenAdminSettings() {
    shell('Business settings', `<div class="empty-state">Loading…</div>`, { activeTab: 'more' });
    const s = await Api.call('getSettings');
    document.querySelector('.screen').innerHTML = `
      <div class="field"><label>Company name</label><input id="setName" value="${esc(s.companyName || '')}"></div>
      <div class="field"><label>Motto</label><input id="setMotto" value="${esc(s.motto || '')}"></div>
      <div class="checkbox-row" style="margin-bottom:14px;">
        <input type="checkbox" id="setGst" ${s.gstEnabled === 'true' || s.gstEnabled === true ? 'checked' : ''}>
        <label for="setGst">GST enabled</label>
      </div>
      <div class="field"><label>Logo URL (optional)</label><input id="setLogo" value="${esc(s.logoUrl || '')}"></div>
      <button class="btn btn-primary" id="saveSettings">Save settings</button>
    `;
    document.getElementById('saveSettings').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        await Api.call('updateSettings', {
          updates: {
            companyName: document.getElementById('setName').value,
            motto: document.getElementById('setMotto').value,
            gstEnabled: document.getElementById('setGst').checked ? 'true' : 'false',
            logoUrl: document.getElementById('setLogo').value
          }
        });
        toast('Settings saved.');
      } catch (err) { toast(err.message); }
      e.target.disabled = false; e.target.textContent = 'Save settings';
    };
  }

  // ---------- ROUTER ----------

  function parseQuery(str) {
    const out = {};
    if (!str) return out;
    str.split('&').forEach(pair => {
      const [k, v] = pair.split('=');
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return out;
  }

  async function route() {
    const hasToken = !!Api.getToken();
    const raw = (location.hash || '#/dashboard').slice(1);
    const [path, queryStr] = raw.split('?');
    const segments = path.split('/').filter(Boolean);
    const query = parseQuery(queryStr);

    if (!hasToken) { screenLogin(); return; }
    if (segments[0] === 'login') { navigate('#/dashboard'); return; }

    try {
      if (segments.length === 0 || segments[0] === 'dashboard') return screenDashboard();
      if (segments[0] === 'more') return screenMore();
      if (segments[0] === 'customers') {
        if (segments.length === 1) return screenCustomers();
        if (segments[1] === 'new') return screenNewCustomer();
        if (segments.length === 3 && segments[2] === 'pay') return screenRecordPayment(segments[1], query.sale);
        return screenCustomerDetail(segments[1]);
      }
      if (segments[0] === 'payments' && segments[1] === 'new') return screenRecordPayment(query.customer, query.sale);
      if (segments[0] === 'sales') {
        if (segments.length === 1) return screenSales();
        if (segments[1] === 'new') return screenNewSale(query.customer);
        return screenSaleDetail(segments[1]);
      }
      if (segments[0] === 'quotations') {
        if (segments.length === 1) return screenQuotations();
        if (segments[1] === 'new') return screenNewQuotation();
        if (segments.length === 3 && segments[2] === 'convert') return screenConvertQuotation(segments[1]);
        return screenQuotationDetail(segments[1]);
      }
      if (segments[0] === 'production') {
        if (segments.length === 1) return screenProduction();
        if (segments[1] === 'new') return screenNewProduction();
      }
      if (segments[0] === 'inventory') {
        if (segments.length === 1) return screenInventory();
        if (segments.length === 3 && segments[2] === 'adjust') return screenAdjustStock(segments[1]);
        return screenInventoryItem(segments[1]);
      }
      if (segments[0] === 'admin') {
        if (segments[1] === 'products') {
          if (segments[2] === 'new') return screenNewProduct();
          return screenAdminProducts();
        }
        if (segments[1] === 'prices') {
          if (segments.length === 3) return screenAdminPriceItem(segments[2]);
          return screenAdminPrices();
        }
        if (segments[1] === 'bottle') {
          if (segments.length === 3) return screenAdminBottleItem(segments[2]);
          return screenAdminBottle();
        }
        if (segments[1] === 'settings') return screenAdminSettings();
      }
      // fallback
      return screenDashboard();
    } catch (e) {
      toast(e.message || 'Something went wrong.');
    }
  }

  function init() {
    window.addEventListener('hashchange', route);
    route();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);

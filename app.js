/* =================================================================
   Finanzas Personales — Frontend (JS plano, sin frameworks)
   Mismo patrón que el Board de ALLTANSA:
   GitHub Pages -> Google Apps Script -> Google Sheets
   Requiere config.js con API_URL, API_TOKEN y (opcional) SHEET_URL
================================================================= */

/* ---------------- helpers de fecha ---------------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function ymKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function monthKeyFromDate(iso) { return iso.slice(0, 7); }
const DOW = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function monthLabelLong(ymk) { const [y, m] = ymk.split('-'); return `${MONTHS[parseInt(m, 10) - 1]} ${y}`; }
function monthLabelShort(ymk) { const [y, m] = ymk.split('-'); return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${y}`; }
function addMonths(ymk, delta) {
  let [y, m] = ymk.split('-').map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${pad2(m)}`;
}
function buildCalendarWeeks(ymk) {
  const [y, m] = ymk.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${pad2(m)}-${pad2(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
function fmt(n, currency) {
  currency = currency === 'USD' ? 'USD' : 'MXN';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n) || 0);
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- íconos / colores ---------------- */
const ICONS = {
  home: '🏠', car: '🚗', phone: '📱', food: '🍽️', fun: '🎮', users: '👥', fuel: '⛽',
  cart: '🛒', school: '🎓', health: '❤️', gift: '🎁', bank: '🏦', coins: '🪙', piggy: '🐷',
  wallet: '👛', briefcase: '💼', percent: '%', hand: '🤝', cash: '💵', building: '🏢', tag: '🏷️',
};
const ICON_KEYS = Object.keys(ICONS);
function iconEmoji(k) { return ICONS[k] || '🏷️'; }

const COLORS = ['#2F6FE0', '#E0357A', '#3AA0C9', '#C0392B', '#1F7A3E', '#6DBF4B', '#E08E19', '#2E8F87', '#8A5A2E', '#7A4EC9', '#C9A227', '#4E5D78'];

/* ---------------- estado ---------------- */
let STATE = {
  transactions: [], catIngreso: [], catGasto: [], caja: { mxn: 0, usd: 0 }, cajaLog: [],
  loaded: false, mainTab: 'saldo', secTab: null, month: ymKey(new Date()), selectedDay: todayISO(),
};
let catFormTipo = 'gasto', catFormIcon = ICON_KEYS[0], catFormColor = COLORS[0], catFormNombreDraft = '';
let uiCajaEditMoneda = null, uiCajaMoveModal = null;
let repMoneda = 'MXN', repHistMeses = 6, repProjMeses = 3, repYear = null;
let trendChartInstance = null;

/* ---------------- API ---------------- */
async function api(action, payload) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS con Apps Script
      body: JSON.stringify({ token: API_TOKEN, action, payload: payload || {} }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: 'No se pudo conectar con el backend: ' + e.message };
  }
}

function normalizeTx(t) { return Object.assign({}, t, { monto: Number(t.monto) }); }
function normalizeLog(l) { return Object.assign({}, l, { delta: Number(l.delta), resultante: Number(l.resultante) }); }

async function loadAll() {
  const res = await api('getAll');
  if (!res.ok) {
    document.getElementById('app').innerHTML =
      `<div class="fin-loading">Error al cargar: ${escapeHtml(res.error || 'desconocido')}<br><br>Revisa API_URL y API_TOKEN en config.js.</div>`;
    return;
  }
  STATE.transactions = (res.data.transactions || []).map(normalizeTx);
  STATE.catIngreso = res.data.catIngreso || [];
  STATE.catGasto = res.data.catGasto || [];
  STATE.caja = res.data.caja || { mxn: 0, usd: 0 };
  STATE.cajaLog = (res.data.cajaLog || []).map(normalizeLog);
  STATE.loaded = true;
  render();
}

/* ---------------- toast ---------------- */
function showToast(msg) {
  const old = document.getElementById('finToast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'finToast'; t.className = 'fin-toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { if (t) t.remove(); }, 2200);
}

/* ---------------- mutaciones ---------------- */
async function saveTransaccion(tx) {
  const action = tx.id ? 'updateTransaccion' : 'addTransaccion';
  const res = await api(action, tx);
  if (!res.ok) { showToast('Error: ' + res.error); return; }
  if (tx.id) {
    STATE.transactions = STATE.transactions.map((t) => (t.id === tx.id ? tx : t));
    showToast('Movimiento actualizado');
  } else {
    STATE.transactions.unshift(Object.assign({}, tx, { id: res.data.id }));
    showToast(tx.tipo === 'ingreso' ? 'Ingreso guardado' : 'Gasto guardado');
  }
  render();
}

async function deleteTransaccion(id) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  const res = await api('deleteTransaccion', { id });
  if (!res.ok) { showToast('Error: ' + res.error); return; }
  STATE.transactions = STATE.transactions.filter((t) => t.id !== id);
  render();
  showToast('Movimiento eliminado');
}

async function addCategoria(tipo, nombre, icon, color) {
  nombre = (nombre || '').trim();
  if (!nombre) return;
  const list = tipo === 'ingreso' ? STATE.catIngreso : STATE.catGasto;
  if (list.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) { showToast('Esa categoría ya existe'); return; }
  const res = await api('addCategoria', { tipo, nombre, icon, color });
  if (!res.ok) { showToast('Error: ' + res.error); return; }
  const newCat = { id: res.data.id, nombre, icon, color };
  if (tipo === 'ingreso') STATE.catIngreso.push(newCat); else STATE.catGasto.push(newCat);
  render();
  showToast('Categoría agregada');
}
async function deleteCategoria(tipo, id) {
  if (STATE.transactions.some((t) => t.tipo === tipo && t.categoriaId === id)) { showToast('No se puede borrar: tiene movimientos'); return; }
  if (!confirm('¿Eliminar esta categoría?')) return;
  const res = await api('deleteCategoria', { tipo, id });
  if (!res.ok) { showToast('Error: ' + res.error); return; }
  if (tipo === 'ingreso') STATE.catIngreso = STATE.catIngreso.filter((c) => c.id !== id);
  else STATE.catGasto = STATE.catGasto.filter((c) => c.id !== id);
  render();
}

async function cajaAjustar(moneda, nuevoValor, nota) {
  const key = moneda.toLowerCase();
  const anterior = STATE.caja[key] || 0;
  const delta = nuevoValor - anterior;
  const payload = { mxn: moneda === 'MXN' ? nuevoValor : STATE.caja.mxn, usd: moneda === 'USD' ? nuevoValor : STATE.caja.usd };
  const res = await api('setCaja', payload);
  if (!res.ok) { showToast('Error: ' + res.error); return; }
  STATE.caja[key] = nuevoValor;
  const logPayload = { fecha: todayISO(), moneda, tipo: 'ajuste', delta, resultante: nuevoValor, nota: nota || 'Ajuste manual del saldo' };
  const logRes = await api('addCajaLog', logPayload);
  STATE.cajaLog.unshift(Object.assign({ id: logRes.data ? logRes.data.id : null }, logPayload));
  uiCajaEditMoneda = null;
  render();
  showToast('Saldo actualizado');
}
async function cajaMover(moneda, tipo, monto, nota) {
  const key = moneda.toLowerCase();
  const anterior = STATE.caja[key] || 0;
  const delta = tipo === 'deposito' ? monto : -monto;
  const nuevo = anterior + delta;
  const payload = { mxn: moneda === 'MXN' ? nuevo : STATE.caja.mxn, usd: moneda === 'USD' ? nuevo : STATE.caja.usd };
  const res = await api('setCaja', payload);
  if (!res.ok) { showToast('Error: ' + res.error); return; }
  STATE.caja[key] = nuevo;
  const logPayload = { fecha: todayISO(), moneda, tipo, delta, resultante: nuevo, nota: nota || '' };
  const logRes = await api('addCajaLog', logPayload);
  STATE.cajaLog.unshift(Object.assign({ id: logRes.data ? logRes.data.id : null }, logPayload));
  uiCajaMoveModal = null;
  render();
  showToast(tipo === 'deposito' ? 'Depósito registrado' : 'Retiro registrado');
}

/* ---------------- navegación ---------------- */
function setMainTab(tab) { STATE.mainTab = tab; render(); }
function setSecTab(tab) { STATE.secTab = tab || null; render(); }
function monthShift(delta) { STATE.month = addMonths(STATE.month, delta); render(); }
function selectDay(d) { STATE.selectedDay = d; render(); }
function getMonthTx() { return STATE.transactions.filter((t) => monthKeyFromDate(t.fecha) === STATE.month); }
function getDayTx() { return STATE.transactions.filter((t) => t.fecha === STATE.selectedDay).sort((a, b) => (a.tipo < b.tipo ? -1 : 1)); }

/* ---------------- categorías: form draft ---------------- */
function saveCatNombreDraft() { const el = document.getElementById('nuevaCatNombre'); if (el) catFormNombreDraft = el.value; }
function restoreCatNombreDraft() { const el = document.getElementById('nuevaCatNombre'); if (el) el.value = catFormNombreDraft; }
function setCatFormTipo(t) { catFormTipo = t; catFormNombreDraft = ''; render(); }
function pickCatIcon(k) { saveCatNombreDraft(); catFormIcon = k; render(); restoreCatNombreDraft(); }
function pickCatColor(c) { saveCatNombreDraft(); catFormColor = c; render(); restoreCatNombreDraft(); }
async function submitNuevaCategoria() {
  const el = document.getElementById('nuevaCatNombre');
  const nombre = el ? el.value : '';
  await addCategoria(catFormTipo, nombre, catFormIcon, catFormColor);
  catFormNombreDraft = '';
}

/* ---------------- caja chica: UI ---------------- */
function openCajaEdit(moneda) { uiCajaEditMoneda = moneda; uiCajaMoveModal = null; render(); }
function cancelCajaEdit() { uiCajaEditMoneda = null; render(); }
async function confirmCajaEdit() {
  const v = parseFloat(document.getElementById('cajaEditValor').value);
  const nota = document.getElementById('cajaEditNota').value;
  if (isNaN(v)) return;
  await cajaAjustar(uiCajaEditMoneda, v, nota);
}
function openCajaMove(moneda, tipo) { uiCajaMoveModal = { moneda, tipo }; uiCajaEditMoneda = null; render(); }
function cancelCajaMove() { uiCajaMoveModal = null; render(); }
async function confirmCajaMove() {
  const m = parseFloat(document.getElementById('cajaMoveMonto').value);
  const nota = document.getElementById('cajaMoveNota').value;
  if (!m || m <= 0) return;
  await cajaMover(uiCajaMoveModal.moneda, uiCajaMoveModal.tipo, m, nota);
}

/* ---------------- reportes: UI ---------------- */
function setRepMoneda(m) { repMoneda = m; render(); }
function setRepYear(y) { repYear = y; render(); }
function setRepHist(v) { repHistMeses = Number(v); render(); }
function setRepProj(v) { repProjMeses = Number(v); render(); }

/* ---------------- modal transacción ---------------- */
function openTxModal(tipo, existingId) {
  const cats = tipo === 'ingreso' ? STATE.catIngreso : STATE.catGasto;
  const existing = existingId ? STATE.transactions.find((t) => t.id === existingId) : null;
  const draft = {
    id: existing ? existing.id : null,
    tipo, monto: existing ? String(existing.monto) : '', moneda: existing ? existing.moneda : 'MXN',
    fecha: existing ? existing.fecha : STATE.selectedDay, categoriaId: existing ? existing.categoriaId : '', nota: existing ? existing.nota : '',
  };
  let showPicker = false;

  const overlay = document.createElement('div');
  overlay.className = 'fin-modal-overlay';
  document.body.appendChild(overlay);
  function close() { if (overlay.parentNode) document.body.removeChild(overlay); }

  function paint() {
    const headerColor = tipo === 'ingreso' ? '#2f9e44' : '#c0392b';
    const selectedCat = cats.find((c) => c.id === draft.categoriaId);
    if (!showPicker) {
      overlay.innerHTML = `
        <div class="fin-modal">
          <div class="fin-modal-head" style="background:${headerColor}">
            <div>
              <div style="font-weight:700;font-size:15px;">${tipo === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo gasto'}</div>
              <div style="font-size:12px;opacity:.85;">${draft.fecha}</div>
            </div>
            <button id="modalCloseX" style="background:transparent;border:none;color:#fff;cursor:pointer;font-size:18px;">✕</button>
          </div>
          <div class="fin-modal-body">
            <div style="display:flex;gap:8px;margin-bottom:12px;">
              <input id="montoInput" class="fin-input fin-num" style="flex:1;font-size:20px;font-weight:700;text-align:center;" type="number" min="0" step="0.01" placeholder="0.00" value="${escapeHtml(draft.monto)}" />
              <select id="monedaInput" class="fin-select" style="width:84px;">
                <option value="MXN" ${draft.moneda === 'MXN' ? 'selected' : ''}>MXN</option>
                <option value="USD" ${draft.moneda === 'USD' ? 'selected' : ''}>USD</option>
              </select>
            </div>
            <div style="margin-bottom:10px;">
              <div class="fin-label" style="margin-bottom:5px;">Fecha</div>
              <input id="fechaInput" class="fin-input" type="date" value="${draft.fecha}" />
            </div>
            <div style="margin-bottom:10px;">
              <div class="fin-label" style="margin-bottom:5px;">Categoría</div>
              <button id="openPicker" class="fin-btn outline" style="width:100%;justify-content:flex-start;">
                ${selectedCat ? `<span class="fin-txic" style="background:${selectedCat.color};width:24px;height:24px;font-size:13px;">${iconEmoji(selectedCat.icon)}</span> ${escapeHtml(selectedCat.nombre)}` : 'Elige una categoría...'}
              </button>
            </div>
            <div>
              <div class="fin-label" style="margin-bottom:5px;">Nota (opcional)</div>
              <input id="notaInput" class="fin-input" placeholder="Añadir nota..." value="${escapeHtml(draft.nota)}" />
            </div>
          </div>
          <div class="fin-modal-foot">
            <button id="modalClose">Cerrar</button>
            <button class="save" id="modalSave">Guardar</button>
          </div>
        </div>`;
      document.getElementById('modalCloseX').onclick = close;
      document.getElementById('modalClose').onclick = close;
      document.getElementById('montoInput').oninput = (e) => { draft.monto = e.target.value; };
      document.getElementById('monedaInput').onchange = (e) => { draft.moneda = e.target.value; };
      document.getElementById('fechaInput').onchange = (e) => { draft.fecha = e.target.value; };
      document.getElementById('notaInput').oninput = (e) => { draft.nota = e.target.value; };
      document.getElementById('openPicker').onclick = () => { showPicker = true; paint(); };
      document.getElementById('modalSave').onclick = async () => {
        const m = parseFloat(draft.monto);
        if (!m || m <= 0 || !draft.categoriaId) { alert('Ingresa un monto válido y elige una categoría.'); return; }
        await saveTransaccion({ id: draft.id, tipo: draft.tipo, monto: m, moneda: draft.moneda, fecha: draft.fecha, categoriaId: draft.categoriaId, nota: draft.nota });
        close();
      };
    } else {
      overlay.innerHTML = `
        <div class="fin-modal">
          <div class="fin-modal-head" style="background:${headerColor}">
            <div style="font-weight:700;font-size:15px;">Elige una categoría</div>
            <button id="pickerCloseX" style="background:transparent;border:none;color:#fff;cursor:pointer;font-size:18px;">✕</button>
          </div>
          <div class="fin-modal-body" style="max-height:50vh;overflow:auto;">
            ${cats.length === 0
              ? '<div class="fin-empty">No hay categorías creadas. Ve a la pestaña "Categorías" para crear una.</div>'
              : cats.map((c) => `
                <div class="cat-pick" data-id="${c.id}" style="display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid #eef1ee;cursor:pointer;border-left:4px solid ${c.color};padding-left:10px;">
                  <span class="fin-txic" style="background:${c.color}">${iconEmoji(c.icon)}</span>
                  <span style="font-weight:600;font-size:13.5px;">${escapeHtml(c.nombre)}</span>
                </div>`).join('')}
          </div>
          <div class="fin-modal-foot"><button id="pickerClose">Cerrar</button></div>
        </div>`;
      document.getElementById('pickerCloseX').onclick = () => { showPicker = false; paint(); };
      document.getElementById('pickerClose').onclick = () => { showPicker = false; paint(); };
      overlay.querySelectorAll('.cat-pick').forEach((el) => {
        el.onclick = () => { draft.categoriaId = el.getAttribute('data-id'); showPicker = false; paint(); };
      });
    }
  }
  paint();
}

/* ---------------- render principal ---------------- */
function render() {
  const root = document.getElementById('app');
  if (!STATE.loaded) { root.innerHTML = '<div class="fin-loading">Cargando tus datos…</div>'; return; }
  root.innerHTML = renderTopBar() + renderSecNav() + '<div class="fin-body">' + renderBody() + '</div>';
  if (STATE.secTab === 'reportes') drawTrendChart();
}

function renderTopBar() {
  return `<div class="fin-topbar">
    ${pillBtn('ingresos', 'Ingresos', '#2f9e44', '📈')}
    ${pillBtn('saldo', 'Saldo', '#e08e19', '⚖️')}
    ${pillBtn('gastos', 'Gastos', '#c0392b', '📉')}
  </div>`;
}
function pillBtn(tab, label, color, emoji) {
  const active = STATE.mainTab === tab;
  return `<button class="fin-pill ${active ? 'active' : ''}" onclick="setMainTab('${tab}')">
    <div class="fin-pill-ic" style="background:${active ? color : '#c9d6cc'}">${emoji}</div>
    <div class="fin-pill-label" style="color:${active ? color : '#7a877e'}">${label}</div>
  </button>`;
}
function renderSecNav() {
  const items = [['', '📅 Día a día'], ['reportes', '📊 Reportes'], ['caja', '👛 Caja chica'], ['categorias', '⚙️ Categorías']];
  let html = '<div class="fin-secnav">' + items.map(([tab, label]) => {
    const active = (STATE.secTab || '') === tab;
    return `<button class="fin-secbtn ${active ? 'active' : ''}" onclick="setSecTab('${tab}')">${label}</button>`;
  }).join('');
  if (typeof SHEET_URL !== 'undefined' && SHEET_URL) {
    html += `<a class="fin-secbtn" href="${SHEET_URL}" target="_blank" rel="noopener" style="text-decoration:none;">🔗 Abrir Sheet</a>`;
  }
  html += '</div>';
  return html;
}
function renderBody() {
  if (STATE.secTab === 'reportes') return renderReportes();
  if (STATE.secTab === 'caja') return renderCaja();
  if (STATE.secTab === 'categorias') return renderCategorias();
  return renderDayView();
}
function renderDayView() {
  const monthBar = `<div class="fin-monthbar">
    <span class="side" onclick="monthShift(-1)">${monthLabelShort(addMonths(STATE.month, -1))}</span>
    <button onclick="monthShift(-1)">‹</button>
    <div>${monthLabelLong(STATE.month)}</div>
    <button onclick="monthShift(1)">›</button>
    <span class="side" onclick="monthShift(1)">${monthLabelShort(addMonths(STATE.month, 1))}</span>
  </div>`;
  let content;
  if (STATE.mainTab === 'saldo') content = renderSaldo();
  else if (STATE.mainTab === 'ingresos') content = renderCategoriaBars('ingreso');
  else content = renderCategoriaBars('gasto');
  return monthBar + content;
}

/* ---------------- vista saldo ---------------- */
function renderSaldo() {
  const monthTx = getMonthTx();
  const ingresos = monthTx.filter((t) => t.tipo === 'ingreso' && t.moneda !== 'USD').reduce((s, t) => s + Number(t.monto), 0);
  const gastos = monthTx.filter((t) => t.tipo === 'gasto' && t.moneda !== 'USD').reduce((s, t) => s + Number(t.monto), 0);
  const saldo = ingresos - gastos;
  const weeks = buildCalendarWeeks(STATE.month);
  const dayHasIngreso = (d) => monthTx.some((t) => t.fecha === d && t.tipo === 'ingreso');
  const dayHasGasto = (d) => monthTx.some((t) => t.fecha === d && t.tipo === 'gasto');

  let html = `<div class="fin-summary">
    <div class="fin-summary-row"><span>Ingresos</span><span class="fin-num" style="color:#2f9e44;font-weight:700;">${fmt(ingresos)}</span></div>
    <div class="fin-summary-row"><span>Gastos</span><span class="fin-num" style="color:#c0392b;font-weight:700;">${fmt(gastos)}</span></div>
    <div class="fin-summary-row total"><span>Saldo</span><span class="fin-num" style="color:${saldo >= 0 ? '#233029' : '#c0392b'}">${fmt(saldo)}</span></div>
  </div>`;

  html += `<div class="fin-actions">
    <button class="fin-actbtn" onclick="openTxModal('ingreso')"><div class="ic" style="background:#2f9e44">+</div>Añadir ingreso</button>
    <button class="fin-actbtn" onclick="openTxModal('gasto')"><div class="ic" style="background:#c0392b">−</div>Añadir gasto</button>
  </div>`;

  html += `<div class="fin-cal"><div class="fin-cal-head">${DOW.map((d) => `<div>${d}</div>`).join('')}</div>`;
  weeks.forEach((w) => {
    html += '<div class="fin-cal-row">';
    w.forEach((d) => {
      if (!d) { html += '<div class="fin-cal-cell"></div>'; return; }
      const classes = ['fin-cal-cell'];
      if (d === todayISO()) classes.push('today');
      if (d === STATE.selectedDay) classes.push('selected');
      html += `<div class="${classes.join(' ')}" onclick="selectDay('${d}')">
        ${parseInt(d.slice(8), 10)}
        <div class="dots">
          ${dayHasIngreso(d) ? '<span class="fin-dot" style="background:#2f9e44"></span>' : ''}
          ${dayHasGasto(d) ? '<span class="fin-dot" style="background:#c0392b"></span>' : ''}
        </div>
      </div>`;
    });
    html += '</div>';
  });
  html += '</div>';
  html += `<div class="fin-legend">
    <span><span class="fin-dot" style="background:#2f9e44"></span> Día con ingresos</span>
    <span><span class="fin-dot" style="background:#f5d565"></span> Hoy</span>
    <span><span class="fin-dot" style="background:#c0392b"></span> Día con gastos</span>
  </div>`;

  const dayTx = getDayTx();
  html += `<div style="margin-top:14px;"><div class="fin-txlist-head">🔎 Transacciones de ${STATE.selectedDay}</div>`;
  if (dayTx.length === 0) html += '<div class="fin-empty" style="border:1px solid #eef1ee;border-top:none;">Sin movimientos este día.</div>';
  dayTx.forEach((t) => {
    const cats = t.tipo === 'ingreso' ? STATE.catIngreso : STATE.catGasto;
    const c = cats.find((x) => x.id === t.categoriaId);
    html += `<div class="fin-txcard">
      <div class="fin-txleft">
        <div class="fin-txic" style="background:${c ? c.color : '#9aa79e'}">${iconEmoji(c ? c.icon : '')}</div>
        <div>
          <div class="fin-txname">${escapeHtml(c ? c.nombre : 'Sin categoría')}</div>
          ${t.nota ? `<div class="fin-txnote">Nota: ${escapeHtml(t.nota)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="fin-num" style="font-weight:700;color:${t.tipo === 'ingreso' ? '#2f9e44' : '#c0392b'}">${t.tipo === 'ingreso' ? '+ ' : '- '}${fmt(t.monto, t.moneda)}</span>
        <button class="fin-btn outline" style="padding:6px;" onclick="openTxModal('${t.tipo}','${t.id}')">✎</button>
        <button class="fin-btn ghost" onclick="deleteTransaccion('${t.id}')">🗑</button>
      </div>
    </div>`;
  });
  html += '</div>';
  return html;
}

/* ---------------- vista ingresos/gastos por categoría ---------------- */
function renderCategoriaBars(tipo) {
  const cats = tipo === 'ingreso' ? STATE.catIngreso : STATE.catGasto;
  const monthTx = getMonthTx();
  const relevant = monthTx.filter((t) => t.tipo === tipo && t.moneda !== 'USD');
  const usd = monthTx.filter((t) => t.tipo === tipo && t.moneda === 'USD');
  const total = relevant.reduce((s, t) => s + Number(t.monto), 0);
  const map = {};
  relevant.forEach((t) => { map[t.categoriaId] = (map[t.categoriaId] || 0) + Number(t.monto); });
  const byCat = Object.entries(map).map(([id, monto]) => ({ id, monto, cat: cats.find((c) => c.id === id) })).sort((a, b) => b.monto - a.monto);
  const colorMain = tipo === 'ingreso' ? '#2f9e44' : '#c0392b';

  let html = `<div class="fin-actions">
    <button class="fin-actbtn" onclick="openTxModal('${tipo}')"><div class="ic" style="background:${colorMain}">+</div>${tipo === 'ingreso' ? 'Añadir ingreso' : 'Añadir gasto'}</button>
  </div>`;
  html += `<div class="fin-card"><div class="fin-label" style="margin-bottom:8px;">Distribución por categoría · ${tipo === 'ingreso' ? 'ingresos' : 'gastos'} del mes</div>`;
  if (byCat.length === 0) {
    html += `<div class="fin-empty">Este mes aún no hay transacciones de ${tipo === 'ingreso' ? 'ingresos' : 'gastos'}. En cuanto empieces a añadir, este gráfico estará disponible con los detalles resumidos.</div>`;
  } else {
    byCat.forEach(({ monto, cat }) => {
      const pct = total ? (monto / total) * 100 : 0;
      html += `<div class="fin-bar-row">
        <div class="fin-bar-ic" style="background:${cat ? cat.color : '#9aa79e'}">${iconEmoji(cat ? cat.icon : '')}</div>
        <div class="fin-bar-track">
          <div class="fin-bar-name"><span>${escapeHtml(cat ? cat.nombre : 'Sin categoría')}</span><span class="fin-num">${fmt(monto)}</span></div>
          <div class="fin-bar-bg"><div class="fin-bar-fill" style="width:${Math.max(pct, 6)}%;background:${cat ? cat.color : '#9aa79e'}">${pct.toFixed(1)}%</div></div>
        </div>
      </div>`;
    });
  }
  html += '</div>';

  if (usd.length > 0) {
    html += '<div class="fin-card"><div class="fin-label" style="margin-bottom:8px;">En dólares (USD) este mes</div>';
    usd.forEach((t) => {
      const c = cats.find((x) => x.id === t.categoriaId);
      html += `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;">
        <span>${escapeHtml(c ? c.nombre : 'Sin categoría')}${t.nota ? ' — ' + escapeHtml(t.nota) : ''}</span>
        <span class="fin-num" style="font-weight:700;">${fmt(t.monto, 'USD')}</span>
      </div>`;
    });
    html += '</div>';
  }
  return html;
}

/* ---------------- vista categorías (gestión) ---------------- */
function renderCategorias() {
  const cats = catFormTipo === 'ingreso' ? STATE.catIngreso : STATE.catGasto;
  let html = `<div class="fin-actions">
    <button class="fin-actbtn" style="background:${catFormTipo === 'gasto' ? '#233029' : '#f2f4f2'};color:${catFormTipo === 'gasto' ? '#fff' : '#3a473f'}" onclick="setCatFormTipo('gasto')">Categorías de gasto</button>
    <button class="fin-actbtn" style="background:${catFormTipo === 'ingreso' ? '#233029' : '#f2f4f2'};color:${catFormTipo === 'ingreso' ? '#fff' : '#3a473f'}" onclick="setCatFormTipo('ingreso')">Categorías de ingreso</button>
  </div>`;

  html += `<div class="fin-card">
    <div class="fin-label" style="margin-bottom:8px;">Nueva categoría de ${catFormTipo === 'ingreso' ? 'ingreso' : 'gasto'}</div>
    <input id="nuevaCatNombre" class="fin-input" placeholder="Nombre" style="margin-bottom:10px;" value="${escapeHtml(catFormNombreDraft)}" />
    <div class="fin-label" style="margin-bottom:6px;">Ícono</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
      ${ICON_KEYS.map((k) => `<div class="fin-iconpick ${catFormIcon === k ? 'sel' : ''}" onclick="pickCatIcon('${k}')">${iconEmoji(k)}</div>`).join('')}
    </div>
    <div class="fin-label" style="margin-bottom:6px;">Color</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
      ${COLORS.map((c) => `<div class="fin-swatch ${catFormColor === c ? 'sel' : ''}" style="background:${c}" onclick="pickCatColor('${c}')"></div>`).join('')}
    </div>
    <button class="fin-btn" onclick="submitNuevaCategoria()">+ Agregar categoría</button>
  </div>`;

  html += `<div class="fin-card"><div class="fin-label" style="margin-bottom:8px;">Tus categorías de ${catFormTipo === 'ingreso' ? 'ingreso' : 'gasto'} (${cats.length})</div>`;
  if (cats.length === 0) html += '<div class="fin-empty">Aún no creas ninguna.</div>';
  cats.forEach((c) => {
    const usage = STATE.transactions.filter((t) => t.tipo === catFormTipo && t.categoriaId === c.id).length;
    html += `<div class="cat-row">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="fin-txic" style="background:${c.color}">${iconEmoji(c.icon)}</div>
        <span style="font-weight:600;font-size:13.5px;">${escapeHtml(c.nombre)}</span>
        <span style="font-size:11.5px;color:#8a978f;">${usage} mov.</span>
      </div>
      <button class="fin-btn ghost" onclick="deleteCategoria('${catFormTipo}','${c.id}')">🗑</button>
    </div>`;
  });
  html += '</div>';
  return html;
}

/* ---------------- vista caja chica ---------------- */
function renderCaja() {
  let html = `<div style="font-size:12.5px;color:#5c6b62;background:#fafcfa;border:1px solid #e7ece7;border-radius:8px;padding:10px 12px;margin-bottom:14px;">
    ⚠️ El saldo de caja chica funciona como tu nota actual: lo ajustas al valor real cuando quieras, o registras retiros/depósitos puntuales. Cada cambio queda en el historial.
  </div>`;

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">';
  ['MXN', 'USD'].forEach((moneda) => {
    const key = moneda.toLowerCase();
    html += `<div class="fin-kpi gold">
      <div class="fin-label">Saldo en ${moneda}</div>
      <div class="fin-value fin-num">${fmt(STATE.caja[key] || 0, moneda)}</div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
        <button class="fin-btn outline" style="font-size:11.5px;padding:6px 8px;" onclick="openCajaEdit('${moneda}')">Ajustar</button>
        <button class="fin-btn outline" style="font-size:11.5px;padding:6px 8px;" onclick="openCajaMove('${moneda}','deposito')">+ Depósito</button>
        <button class="fin-btn outline" style="font-size:11.5px;padding:6px 8px;" onclick="openCajaMove('${moneda}','retiro')">+ Retiro</button>
      </div>
    </div>`;
  });
  html += '</div>';

  if (uiCajaEditMoneda) {
    html += `<div class="fin-card">
      <div class="fin-label" style="margin-bottom:8px;">Ajustar saldo en ${uiCajaEditMoneda} al valor real</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="cajaEditValor" class="fin-input fin-num" type="number" step="0.01" value="${STATE.caja[uiCajaEditMoneda.toLowerCase()] || 0}" style="max-width:140px;" />
        <input id="cajaEditNota" class="fin-input" placeholder="Nota (opcional)" style="flex:1;min-width:140px;" />
        <button class="fin-btn" onclick="confirmCajaEdit()">Guardar</button>
        <button class="fin-btn outline" onclick="cancelCajaEdit()">Cancelar</button>
      </div>
    </div>`;
  }
  if (uiCajaMoveModal) {
    html += `<div class="fin-card">
      <div class="fin-label" style="margin-bottom:8px;">${uiCajaMoveModal.tipo === 'deposito' ? 'Registrar depósito' : 'Registrar retiro'} en ${uiCajaMoveModal.moneda}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="cajaMoveMonto" class="fin-input fin-num" type="number" min="0" step="0.01" placeholder="Monto" style="max-width:120px;" />
        <input id="cajaMoveNota" class="fin-input" placeholder="Ej. Retiro de Andrea..." style="flex:1;min-width:140px;" />
        <button class="fin-btn" onclick="confirmCajaMove()">Guardar</button>
        <button class="fin-btn outline" onclick="cancelCajaMove()">Cancelar</button>
      </div>
    </div>`;
  }

  html += '<div class="fin-card"><div class="fin-label" style="margin-bottom:8px;">Historial de caja chica</div>';
  if (STATE.cajaLog.length === 0) html += '<div class="fin-empty">Sin movimientos registrados todavía.</div>';
  STATE.cajaLog.forEach((l) => {
    html += `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f2f4f2;">
      <div>
        <div style="font-size:13px;font-weight:600;">${l.tipo === 'ajuste' ? 'Ajuste de saldo' : l.tipo === 'deposito' ? 'Depósito' : 'Retiro'} · ${l.moneda}</div>
        <div style="font-size:11.5px;color:#8a978f;">${l.fecha}${l.nota ? ' · ' + escapeHtml(l.nota) : ''}</div>
      </div>
      <div style="text-align:right;">
        <div class="fin-num" style="font-weight:700;color:${Number(l.delta) >= 0 ? '#2f9e44' : '#c0392b'}">${Number(l.delta) >= 0 ? '+' : ''}${fmt(l.delta, l.moneda)}</div>
        <div class="fin-num" style="font-size:11px;color:#8a978f;">saldo: ${fmt(l.resultante, l.moneda)}</div>
      </div>
    </div>`;
  });
  html += '</div>';
  return html;
}

/* ---------------- vista reportes ---------------- */
function buildTrendData(monthlyData, histMeses, projMeses) {
  const base = monthlyData.map((m) => Object.assign({}, m));
  if (base.length === 0) return { labels: [], ingresos: [], gastos: [], ingresosProy: [], gastosProy: [] };
  const lastN = base.slice(-histMeses);
  const avgIn = lastN.reduce((s, m) => s + m.ingresos, 0) / lastN.length;
  const avgOut = lastN.reduce((s, m) => s + m.gastos, 0) / lastN.length;
  let [y, m] = base[base.length - 1].key.split('-').map(Number);
  const proy = [];
  for (let i = 0; i < projMeses; i++) {
    m += 1; if (m > 12) { m = 1; y += 1; }
    proy.push({ key: `${y}-${pad2(m)}` });
  }
  const labels = base.map((b) => b.key).concat(proy.map((p) => p.key));
  const ingresos = base.map((b) => b.ingresos).concat(proy.map(() => null));
  const gastos = base.map((b) => b.gastos).concat(proy.map(() => null));
  const ingresosProy = base.map(() => null); ingresosProy[base.length - 1] = base[base.length - 1].ingresos;
  const gastosProy = base.map(() => null); gastosProy[base.length - 1] = base[base.length - 1].gastos;
  proy.forEach(() => { ingresosProy.push(avgIn); gastosProy.push(avgOut); });
  return { labels, ingresos, gastos, ingresosProy, gastosProy };
}
function drawTrendChart() {
  const canvas = document.getElementById('trendChart');
  if (!canvas || !window.__trendData) return;
  const d = window.__trendData;
  if (trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: d.labels.map(monthLabelShort),
      datasets: [
        { label: 'Ingresos', data: d.ingresos, borderColor: '#2f9e44', backgroundColor: '#2f9e44', tension: .25, spanGaps: true },
        { label: 'Gastos', data: d.gastos, borderColor: '#c0392b', backgroundColor: '#c0392b', tension: .25, spanGaps: true },
        { label: 'Ingresos (proy.)', data: d.ingresosProy, borderColor: '#2f9e44', borderDash: [5, 4], pointRadius: 0, tension: .25, spanGaps: true },
        { label: 'Gastos (proy.)', data: d.gastosProy, borderColor: '#c0392b', borderDash: [5, 4], pointRadius: 0, tension: .25, spanGaps: true },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 10.5 } } } }, scales: { y: { ticks: { callback: (v) => (v / 1000).toFixed(0) + 'k' } } } },
  });
}
function renderReportes() {
  const txMoneda = STATE.transactions.filter((t) => t.moneda === repMoneda);
  const monthlyMap = {};
  txMoneda.forEach((t) => {
    const k = monthKeyFromDate(t.fecha);
    if (!monthlyMap[k]) monthlyMap[k] = { key: k, ingresos: 0, gastos: 0 };
    if (t.tipo === 'ingreso') monthlyMap[k].ingresos += Number(t.monto); else monthlyMap[k].gastos += Number(t.monto);
  });
  const monthlyData = Object.values(monthlyMap).sort((a, b) => (a.key > b.key ? 1 : -1));
  const years = Array.from(new Set(monthlyData.map((m) => m.key.slice(0, 4)))).sort();
  if (!repYear || !years.includes(repYear)) repYear = years[years.length - 1] || '';

  if (STATE.transactions.length === 0) {
    return '<div class="fin-empty" style="padding:50px;">Aún no hay movimientos. Registra ingresos y gastos en "Día a día" para ver reportes aquí.</div>';
  }

  const mesesDelAnio = monthlyData.filter((m) => m.key.startsWith(repYear));
  const ingresoProm = mesesDelAnio.length ? mesesDelAnio.reduce((s, m) => s + m.ingresos, 0) / mesesDelAnio.length : 0;
  const gastoProm = mesesDelAnio.length ? mesesDelAnio.reduce((s, m) => s + m.gastos, 0) / mesesDelAnio.length : 0;

  const gastoMap = {};
  txMoneda.filter((t) => t.tipo === 'gasto').forEach((t) => {
    if (!gastoMap[t.categoriaId]) gastoMap[t.categoriaId] = { count: 0, total: 0 };
    gastoMap[t.categoriaId].count += 1; gastoMap[t.categoriaId].total += Number(t.monto);
  });
  const gastoArr = Object.entries(gastoMap).map(([id, v]) => Object.assign({ id }, v));
  const masFrecuente = gastoArr.slice().sort((a, b) => b.count - a.count)[0];
  const mayorTotal = gastoArr.slice().sort((a, b) => b.total - a.total)[0];
  const findCatGasto = (id) => STATE.catGasto.find((c) => c.id === id);

  let html = `<div style="display:flex;gap:6px;margin-bottom:14px;">
    <button class="fin-secbtn ${repMoneda === 'MXN' ? 'active' : ''}" onclick="setRepMoneda('MXN')">MXN</button>
    <button class="fin-secbtn ${repMoneda === 'USD' ? 'active' : ''}" onclick="setRepMoneda('USD')">USD</button>
  </div>`;

  html += `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px;">
    <div class="fin-kpi"><div class="fin-label">Ingreso promedio mensual · ${repYear || '—'}</div><div class="fin-value fin-num">${fmt(ingresoProm, repMoneda)}</div></div>
    <div class="fin-kpi neg"><div class="fin-label">Gasto promedio mensual · ${repYear || '—'}</div><div class="fin-value fin-num">${fmt(gastoProm, repMoneda)}</div></div>
    <div class="fin-kpi gold"><div class="fin-label">Gasto más frecuente</div><div class="fin-value" style="font-size:14px;">${masFrecuente ? `${escapeHtml((findCatGasto(masFrecuente.id) || {}).nombre || '—')} (${masFrecuente.count}x)` : '—'}</div></div>
    <div class="fin-kpi neg"><div class="fin-label">Mayor gasto acumulado</div><div class="fin-value" style="font-size:14px;">${mayorTotal ? `${escapeHtml((findCatGasto(mayorTotal.id) || {}).nombre || '—')} · ${fmt(mayorTotal.total, repMoneda)}` : '—'}</div></div>
  </div>`;

  if (years.length > 0) {
    html += `<div class="fin-card"><div style="display:flex;justify-content:space-between;align-items:center;">
      <div class="fin-label">Año para promedios</div>
      <select class="fin-select" style="width:auto;" onchange="setRepYear(this.value)">
        ${years.map((y) => `<option value="${y}" ${y === repYear ? 'selected' : ''}>${y}</option>`).join('')}
      </select>
    </div></div>`;
  }

  html += `<div class="fin-card">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:6px;">
      <div class="fin-label">Tendencia ingresos vs. gastos (con proyección) · ${repMoneda}</div>
      <div style="display:flex;gap:8px;font-size:12px;">
        <select class="fin-select" style="width:auto;padding:5px 8px;" onchange="setRepHist(this.value)">
          <option value="3" ${repHistMeses === 3 ? 'selected' : ''}>base: 3 meses</option>
          <option value="6" ${repHistMeses === 6 ? 'selected' : ''}>base: 6 meses</option>
          <option value="12" ${repHistMeses === 12 ? 'selected' : ''}>base: 12 meses</option>
        </select>
        <select class="fin-select" style="width:auto;padding:5px 8px;" onchange="setRepProj(this.value)">
          <option value="3" ${repProjMeses === 3 ? 'selected' : ''}>proyectar 3 meses</option>
          <option value="6" ${repProjMeses === 6 ? 'selected' : ''}>proyectar 6 meses</option>
          <option value="12" ${repProjMeses === 12 ? 'selected' : ''}>proyectar 12 meses</option>
        </select>
      </div>
    </div>
    <canvas id="trendChart" height="220"></canvas>
    <div style="font-size:11.5px;color:#8a978f;margin-top:6px;">La proyección es un promedio simple de los meses base seleccionados: no es un pronóstico garantizado, solo una extrapolación de tu propio historial.</div>
  </div>`;

  window.__trendData = buildTrendData(monthlyData, repHistMeses, repProjMeses);
  return html;
}

/* ---------------- arranque ---------------- */
loadAll();

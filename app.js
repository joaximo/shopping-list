'use strict';

/*
 * Data model: `items` is ONE array whose order is the item's permanent position.
 * Ticking an item only flips `done`; it never moves in the array.
 * The screen shows unticked items (in array order) and then ticked items (in array order),
 * so unticking an item puts it straight back where it was.
 */

const KEY = 'shopping-list-v1';
const $ = (id) => document.getElementById(id);
const todoList = $('todoList');
const doneList = $('doneList');

let items = load();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(data)) return data;
  } catch { /* corrupt or missing: start empty */ }
  return [];
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(items));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const byId = (id) => items.find((it) => it.id === id);

// ---------- Rendering ----------

function row(item) {
  const li = document.createElement('li');
  li.dataset.id = item.id;
  li.innerHTML = `
    <span class="handle" aria-label="Drag to reorder">⠿</span>
    <button class="toggle"><span class="box"></span><span class="name"></span><span class="qty"></span></button>
    <button class="edit" aria-label="Edit">✎</button>`;
  li.querySelector('.name').textContent = item.name;
  li.querySelector('.qty').textContent = item.qty;
  return li;
}

function render() {
  const todo = items.filter((it) => !it.done);
  const done = items.filter((it) => it.done);
  todoList.replaceChildren(...todo.map(row));
  doneList.replaceChildren(...done.map(row));

  $('doneCount').textContent = done.length;
  $('doneHeader').hidden = done.length === 0;
  $('emptyMsg').hidden = todo.length > 0;
  $('emptyMsg').textContent = items.length ? 'Nothing left to buy' : 'Add something to buy above.';
}

function flash(id) {
  const li = document.querySelector(`li[data-id="${id}"]`);
  if (!li) return;
  li.classList.add('flash');
  li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  li.addEventListener('animationend', () => li.classList.remove('flash'), { once: true });
}

// ---------- Adding ----------

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('nameInput').value.trim();
  const qty = $('qtyInput').value.trim();
  if (!name) { $('nameInput').focus(); return; }

  // Re-adding something already on the list re-activates it in its old spot
  // instead of creating a duplicate.
  let item = items.find((it) => it.name.toLowerCase() === name.toLowerCase());
  if (item) {
    item.done = false;
    if (qty) item.qty = qty;
  } else {
    item = { id: uid(), name, qty, done: false };
    items.push(item);
  }
  save();
  render();
  flash(item.id);

  $('nameInput').value = '';
  $('qtyInput').value = '';
  $('nameInput').focus();
});

// ---------- Tick / edit ----------

document.querySelector('main').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const item = byId(li.dataset.id);
  if (!item) return;

  if (e.target.closest('.toggle')) {
    item.done = !item.done;
    save();
    render();
  } else if (e.target.closest('.edit')) {
    openEdit(item);
  }
});

const editDialog = $('editDialog');
let editing = null;

function openEdit(item) {
  editing = item;
  $('editName').value = item.name;
  $('editQty').value = item.qty;
  editDialog.returnValue = '';
  editDialog.showModal();
}

editDialog.addEventListener('close', () => {
  if (editDialog.returnValue === 'save' && editing) {
    editing.name = $('editName').value.trim() || editing.name;
    editing.qty = $('editQty').value.trim();
    save();
    render();
  }
  editing = null;
});

$('deleteBtn').addEventListener('click', () => {
  if (editing && confirm(`Delete "${editing.name}"?`)) {
    items = items.filter((it) => it !== editing);
    save();
    render();
    editDialog.close();
  }
});

// ---------- Menu ----------

const menuDialog = $('menuDialog');
$('menuBtn').addEventListener('click', () => {
  menuDialog.returnValue = '';
  menuDialog.showModal();
});

menuDialog.addEventListener('close', () => {
  if (menuDialog.returnValue === 'untickAll') {
    items.forEach((it) => { it.done = false; });
    save();
    render();
  }
});

// ---------- Import CSV ----------
// Format: one item per row, "Quantity,Item" (quantity may be empty).
// A header row, ";" or tab separators (Excel), and a single "Item" column also work.

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const count = (ch) => first.split(ch).length;
  const sep = [',', ';', '\t'].reduce((a, b) => (count(b) > count(a) ? b : a));

  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvToItems(text) {
  const rows = parseCSV(text)
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some(Boolean));
  const isHeader = (r) => /^(qty|quantity|quantitat|cantidad)$/i.test(r[0]) || /^(item|name|nom|producte|producto)$/i.test(r[1] || '');
  if (rows.length && isHeader(rows[0])) rows.shift();

  const out = [];
  for (const r of rows) {
    const [qty, name] = r.length >= 2 ? [r[0], r[1]] : ['', r[0]];
    if (!name || out.some((it) => it.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ id: uid(), name, qty, done: false });
  }
  return out;
}

function applyImport(newItems, mode) {
  if (mode === 'replace') {
    items = newItems;
  } else {
    for (const n of newItems) {
      const existing = items.find((it) => it.name.toLowerCase() === n.name.toLowerCase());
      if (!existing) items.push(n);
      else if (n.qty) existing.qty = n.qty;
    }
  }
  save();
  render();
  window.scrollTo(0, 0);
}

const fileInput = $('fileInput');
const importDialog = $('importDialog');
let pendingImport = null;

$('importBtn').addEventListener('click', () => {
  menuDialog.close();
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  const newItems = csvToItems(await file.text());
  if (!newItems.length) { alert('No items found in that file.'); return; }

  if (!items.length) { applyImport(newItems, 'replace'); return; }
  pendingImport = newItems;
  $('importCount').textContent = newItems.length;
  importDialog.returnValue = '';
  importDialog.showModal();
});

// ---------- Export CSV ----------
// Same "Quantity,Item" format the importer reads, in list order.

function toCSV() {
  const cell = (v) => (/[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['Quantity', 'Item'], ...items.map((it) => [it.qty, it.name])];
  return '﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

$('exportBtn').addEventListener('click', () => {
  menuDialog.close();
  const blob = new Blob([toCSV()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shopping-list-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});

importDialog.addEventListener('close', () => {
  if (pendingImport && ['replace', 'add'].includes(importDialog.returnValue)) {
    applyImport(pendingImport, importDialog.returnValue);
  }
  pendingImport = null;
});

// ---------- Drag to reorder (by the ⠿ handle) ----------

let drag = null;

document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle) return;
  e.preventDefault();
  const li = handle.closest('li');
  handle.setPointerCapture(e.pointerId);
  drag = { li, list: li.parentElement, pointerId: e.pointerId };
  li.classList.add('dragging');
  navigator.vibrate?.(15);
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const others = [...drag.list.children].filter((el) => el !== drag.li);
  const before = others.find((el) => {
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  });
  if (drag.li.nextElementSibling !== (before || null)) {
    drag.list.insertBefore(drag.li, before || null);
  }
  // Scroll when dragging near the screen edges.
  const topEdge = document.querySelector('.top').getBoundingClientRect().bottom;
  if (e.clientY < topEdge + 40) window.scrollBy(0, -12);
  else if (e.clientY > window.innerHeight - 40) window.scrollBy(0, 12);
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.li.classList.remove('dragging');

  // Put the new order of this section back into the same array slots this
  // section occupied, so items in the other section keep their positions.
  const sectionDone = drag.list === doneList;
  const newOrder = [...drag.list.children].map((li) => byId(li.dataset.id));
  let k = 0;
  items = items.map((it) => (!!it.done === sectionDone ? newOrder[k++] : it));

  drag = null;
  save();
  render();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// ---------- Misc ----------

// Tapping outside any popup closes it (same as Cancel/Close).
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return; // a click inside the content
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  });
});

// Keep several open tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key === KEY) { items = load(); render(); }
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js');
}

render();

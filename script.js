"use strict";

const NS = "http://www.w3.org/2000/svg";
const R = 24; // state radius
const $ = id => document.getElementById(id);
const svg = $("canvas");

// ---------- Data model (single source of truth) ----------
const dfa = {
  states: [],            // [{id, x, y}]
  start: null,           // state id
  accepting: new Set(),  // set of state ids
  trans: {}              // trans[from][symbol] = to
};

let mode = "add", linkFrom = null, dragId = null, counter = 0;

const alphabet = () =>
  $("alphabet").value.split(",").map(s => s.trim()).filter(Boolean);
const byId = id => dfa.states.find(s => s.id === id);
const say = msg => ($("message").textContent = msg);

function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- Editing operations ----------
function addState(x, y) {
  const id = "q" + counter++;
  dfa.states.push({ id, x, y });
  if (!dfa.start) dfa.start = id;
}

function deleteState(id) {
  dfa.states = dfa.states.filter(s => s.id !== id);
  dfa.accepting.delete(id);
  if (dfa.start === id) dfa.start = dfa.states[0]?.id ?? null;
  delete dfa.trans[id];
  for (const from in dfa.trans)
    for (const sym in dfa.trans[from])
      if (dfa.trans[from][sym] === id) delete dfa.trans[from][sym];
}

function addTransition(from, to) {
  const syms = alphabet();
  const sym = prompt(`Symbol for ${from} → ${to}?  (alphabet: ${syms.join(", ")})`);
  if (sym === null) return;
  const s = sym.trim();
  if (!syms.includes(s)) return say(`"${s}" is not in the alphabet.`);
  dfa.trans[from] ??= {};
  if (dfa.trans[from][s] && dfa.trans[from][s] !== to)
    say(`Replaced ${from} on '${s}': was ${dfa.trans[from][s]} (a DFA allows only one).`);
  dfa.trans[from][s] = to;
}

function completeWithDeadState() {
  const syms = alphabet();
  const missing = dfa.states.some(s => syms.some(a => !dfa.trans[s.id]?.[a]));
  if (!missing) return say("DFA is already complete.");
  if (!byId("dead")) dfa.states.push({ id: "dead", x: 80, y: svg.clientHeight - 60 });
  for (const s of dfa.states)
    for (const a of syms) {
      dfa.trans[s.id] ??= {};
      dfa.trans[s.id][a] ??= "dead";
    }
  say("Added a dead state for all missing transitions.");
}

function clearAll() {
  if (!confirm("Clear everything?")) return;
  dfa.states = []; dfa.start = null; dfa.accepting.clear(); dfa.trans = {};
  counter = 0; linkFrom = null;
  say("");
}

// ---------- Mouse / touch handling ----------
function point(e) {
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

svg.addEventListener("pointerdown", e => {
  const id = e.target.closest("g[data-id]")?.dataset.id;
  const p = point(e);

  if (mode === "add") { if (!id) addState(p.x, p.y); }
  else if (mode === "move") { if (id) { dragId = id; svg.setPointerCapture(e.pointerId); } }
  else if (mode === "link") {
    if (id) {
      if (!linkFrom) { linkFrom = id; say(`From ${id}: now click the target state.`); }
      else { addTransition(linkFrom, id); linkFrom = null; }
    }
  }
  else if (mode === "flags") {
    if (id) {
      if (e.shiftKey) dfa.start = id;
      else dfa.accepting.has(id) ? dfa.accepting.delete(id) : dfa.accepting.add(id);
    }
  }
  else if (mode === "delete") { if (id) deleteState(id); }
  render();
});

svg.addEventListener("pointermove", e => {
  if (!dragId) return;
  const s = byId(dragId), p = point(e);
  s.x = p.x; s.y = p.y;
  render();
});
svg.addEventListener("pointerup", () => (dragId = null));

document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", () => {
    mode = r.value; linkFrom = null;
    const hints = {
      add: "Click empty space to add a state.",
      move: "Drag states to move them.",
      link: "Click a source state, then a target state.",
      flags: "Click = toggle accepting. Shift+click = set as start.",
      delete: "Click a state to delete it."
    };
    say(hints[mode]); render();
  })
);

$("alphabet").addEventListener("input", render);
$("complete").addEventListener("click", () => { completeWithDeadState(); render(); });
$("clear").addEventListener("click", () => { clearAll(); render(); });
$("run").addEventListener("click", runTest);

// ---------- Rendering ----------
function render() {
  svg.innerHTML = "";

  const defs = el("defs");
  const marker = el("marker", { id: "arrow", markerWidth: 10, markerHeight: 8, refX: 9, refY: 4, orient: "auto" });
  marker.appendChild(el("path", { d: "M0,0 L10,4 L0,8 z", fill: "#444" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  drawEdges();
  drawStates();
  drawTable();
}

function drawEdges() {
  // group symbols by (from -> to)
  const groups = {};
  for (const from in dfa.trans)
    for (const sym in dfa.trans[from]) {
      const key = from + "|" + dfa.trans[from][sym];
      (groups[key] ??= []).push(sym);
    }

  for (const key in groups) {
    const [from, to] = key.split("|");
    const a = byId(from), b = byId(to);
    if (!a || !b) continue;
    const label = groups[key].join(",");

    if (from === to) { // self-loop above the state
      svg.appendChild(el("path", {
        d: `M ${a.x - 14} ${a.y - 20} C ${a.x - 34} ${a.y - 70}, ${a.x + 34} ${a.y - 70}, ${a.x + 14} ${a.y - 20}`,
        fill: "none", stroke: "#444", "stroke-width": 1.6, "marker-end": "url(#arrow)"
      }));
      svg.appendChild(el("text", { x: a.x, y: a.y - 62, "text-anchor": "middle", class: "edge-label" }, label));
      continue;
    }

    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const curved = groups[to + "|" + from] ? 32 : 0; // curve if both directions exist
    const mx = (a.x + b.x) / 2 + nx * curved, my = (a.y + b.y) / 2 + ny * curved;
    // aim start/end toward the control point so the arrow meets the circle edge
    const sx = a.x + ((mx - a.x) / Math.hypot(mx - a.x, my - a.y)) * R;
    const sy = a.y + ((my - a.y) / Math.hypot(mx - a.x, my - a.y)) * R;
    const ex = b.x - ((b.x - mx) / Math.hypot(b.x - mx, b.y - my)) * R;
    const ey = b.y - ((b.y - my) / Math.hypot(b.x - mx, b.y - my)) * R;

    svg.appendChild(el("path", {
      d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`,
      fill: "none", stroke: "#444", "stroke-width": 1.6, "marker-end": "url(#arrow)"
    }));
    const lx = 0.25 * sx + 0.5 * mx + 0.25 * ex, ly = 0.25 * sy + 0.5 * my + 0.25 * ey;
    svg.appendChild(el("text", { x: lx + nx * 10, y: ly + ny * 10 + 4, "text-anchor": "middle", class: "edge-label" }, label));
  }
}

function drawStates() {
  for (const s of dfa.states) {
    const g = el("g", { "data-id": s.id, class: "state" });
    g.appendChild(el("circle", {
      cx: s.x, cy: s.y, r: R,
      fill: s.id === linkFrom ? "#ffe9a8" : "#fff",
      stroke: "#222", "stroke-width": 2
    }));
    if (dfa.accepting.has(s.id))
      g.appendChild(el("circle", { cx: s.x, cy: s.y, r: R - 5, fill: "none", stroke: "#222", "stroke-width": 1.6 }));
    g.appendChild(el("text", { x: s.x, y: s.y + 5, "text-anchor": "middle", class: "state-label" }, s.id));
    svg.appendChild(g);

    if (dfa.start === s.id) { // start arrow
      svg.appendChild(el("line", {
        x1: s.x - R - 34, y1: s.y, x2: s.x - R, y2: s.y,
        stroke: "#444", "stroke-width": 1.8, "marker-end": "url(#arrow)"
      }));
    }
  }
}

function drawTable() {
  const syms = alphabet();
  let html = "<tr><th>State</th>" + syms.map(a => `<th>${a}</th>`).join("") + "</tr>";
  for (const s of dfa.states) {
    const mark = (dfa.start === s.id ? "→" : "") + (dfa.accepting.has(s.id) ? "*" : "");
    html += `<tr><th>${mark} ${s.id}</th>`;
    for (const a of syms) {
      const t = dfa.trans[s.id]?.[a];
      html += t ? `<td>${t}</td>` : `<td class="missing">—</td>`;
    }
    html += "</tr>";
  }
  $("table").innerHTML = html;
}

// ---------- Test a string ----------
function runTest() {
  let cur = dfa.start;
  if (!cur) return say("Add a start state first.");
  const path = [cur];
  for (const ch of $("input").value) {
    const next = dfa.trans[cur]?.[ch];
    if (!next) return say(`Stuck at ${cur} on '${ch}' (no transition). Path: ${path.join(" → ")}`);
    cur = next; path.push(cur);
  }
  say(`${dfa.accepting.has(cur) ? "ACCEPTED ✅" : "REJECTED ❌"}   Path: ${path.join(" → ")}`);
}

render();

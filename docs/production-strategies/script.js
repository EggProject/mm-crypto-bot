// docs/production-strategies/script.js — megosztott interaktív logika

// Egyszerű ár-formatter (ezer separator, 2 tizedes)
function fmt(v, suffix = "") {
  if (typeof v !== "number" || isNaN(v)) return "—";
  const s = v.toLocaleString("hu-HU", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return s + suffix;
}

function pct(v) { return fmt(v * 100, "%"); }

// SVG helper: vonal rajzolása
function line(x1, y1, x2, y2, opts = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "line");
  el.setAttribute("x1", x1); el.setAttribute("y1", y1);
  el.setAttribute("x2", x2); el.setAttribute("y2", y2);
  el.setAttribute("stroke", opts.color || "#58a6ff");
  el.setAttribute("stroke-width", opts.width || 2);
  if (opts.dash) el.setAttribute("stroke-dasharray", opts.dash);
  return el;
}

function rect(x, y, w, h, opts = {}) {
  const ns = "http://www.w3.org/2000/svg";
  // Becsomagoljuk egy <g>-be, hogy a text gyerek is renderelve legyen (SVG-ben a <text> nem lehet <rect> gyereke)
  const g = document.createElementNS(ns, "g");
  const el = document.createElementNS(ns, "rect");
  el.setAttribute("x", x); el.setAttribute("y", y);
  el.setAttribute("width", w); el.setAttribute("height", h);
  el.setAttribute("fill", opts.fill || "#161b22");
  el.setAttribute("stroke", opts.stroke || "#30363d");
  el.setAttribute("stroke-width", opts.strokeWidth || 1);
  if (opts.rx) el.setAttribute("rx", opts.rx);
  g.appendChild(el);
  if (opts.label) {
    const t = text(x + w / 2, y + h / 2 + 4, opts.label, { fill: opts.textColor || "#c9d1d9", size: opts.size || 12, anchor: "middle" });
    g.appendChild(t);
  }
  return g;
}

function text(x, y, str, opts = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "text");
  el.setAttribute("x", x); el.setAttribute("y", y);
  el.setAttribute("fill", opts.fill || "#c9d1d9");
  el.setAttribute("font-size", opts.size || 13);
  el.setAttribute("font-family", "-apple-system, sans-serif");
  if (opts.anchor) el.setAttribute("text-anchor", opts.anchor);
  if (opts.weight) el.setAttribute("font-weight", opts.weight);
  el.textContent = str;
  return el;
}

function circle(cx, cy, r, opts = {}) {
  const ns = "http://www.w3.org/2000/svg";
  // Ugyanaz a <g> trükk: a <text> csak a <circle> testvércsomópontjaként renderelődik
  const g = document.createElementNS(ns, "g");
  const el = document.createElementNS(ns, "circle");
  el.setAttribute("cx", cx); el.setAttribute("cy", cy);
  el.setAttribute("r", r);
  el.setAttribute("fill", opts.fill || "#58a6ff");
  el.setAttribute("stroke", opts.stroke || "#0d1117");
  el.setAttribute("stroke-width", opts.strokeWidth || 2);
  if (opts.class) el.setAttribute("class", opts.class);
  g.appendChild(el);
  if (opts.label) {
    const t = text(cx, cy + 4, opts.label, { fill: opts.textColor || "#0d1117", size: opts.size || 11, anchor: "middle", weight: 700 });
    g.appendChild(t);
  }
  return g;
}

function arrow(x1, y1, x2, y2, opts = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "line");
  el.setAttribute("x1", x1); el.setAttribute("y1", y1);
  el.setAttribute("x2", x2); el.setAttribute("y2", y2);
  el.setAttribute("stroke", opts.color || "#58a6ff");
  el.setAttribute("stroke-width", opts.width || 2);
  el.setAttribute("marker-end", opts.markerEnd || "url(#arrowhead)");
  if (opts.dash) el.setAttribute("stroke-dasharray", opts.dash);
  return el;
}

function makeSVG(w, h) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.style.maxWidth = "100%";
  // Defs: arrowhead marker
  const defs = document.createElementNS(ns, "defs");
  const marker = document.createElementNS(ns, "marker");
  marker.setAttribute("id", "arrowhead");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("orient", "auto-start-reverse");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  path.setAttribute("fill", "#58a6ff");
  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);
  return svg;
}

// Chart: egyszerű vonalas chart price tömbből
function lineChart(svg, prices, opts = {}) {
  const W = parseInt(svg.getAttribute("viewBox").split(" ")[2]);
  const H = parseInt(svg.getAttribute("viewBox").split(" ")[3]);
  const pad = opts.padding || 40;
  const cw = W - pad * 2;
  const ch = H - pad * 2;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const stepX = cw / (prices.length - 1);

  // Grid
  for (let i = 0; i < 5; i++) {
    const y = pad + (ch / 4) * i;
    svg.appendChild(line(pad, y, W - pad, y, { color: "#21262d", width: 1 }));
    const val = max - (range / 4) * i;
    svg.appendChild(text(pad - 6, y + 4, fmt(val, ""), { fill: "#8b949e", size: 10, anchor: "end" }));
  }

  // Price line
  let dPath = "";
  for (let i = 0; i < prices.length; i++) {
    const x = pad + stepX * i;
    const y = pad + ch - ((prices[i] - min) / range) * ch;
    dPath += (i === 0 ? "M " : " L ") + x + " " + y;
  }
  const ns = "http://www.w3.org/2000/svg";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", dPath);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", opts.color || "#58a6ff");
  path.setAttribute("stroke-width", opts.lineWidth || 2);
  svg.appendChild(path);

  // Signal markers
  if (opts.signals) {
    for (const sig of opts.signals) {
      const i = sig.index;
      const x = pad + stepX * i;
      const y = pad + ch - ((prices[i] - min) / range) * ch;
      const c = circle(x, y, 6, { fill: sig.side === "long" ? "#2ea043" : "#f85149", label: sig.side === "long" ? "L" : "S", textColor: "#fff", size: 8 });
      svg.appendChild(c);
    }
  }

  return svg;
}

// Slider binding helper
function bindSlider(sliderId, valueId, fmtFn = (v) => v) {
  const s = document.getElementById(sliderId);
  const v = document.getElementById(valueId);
  if (!s || !v) return null;
  const update = () => { v.textContent = fmtFn(s.value); s.dispatchEvent(new Event("input")); };
  s.addEventListener("input", update);
  update();
  return s;
}

// Croquis autonome d'état des lieux. Extrait et adapté du moteur historique
// de contrat.html (commit b20d416) : mêmes vues, mêmes types et même format
// de marques { id, view, x, y, type }.
(function (global) {
  "use strict";
  var TYPES = [{ id: "rayure", label: "Rayure", symbole: "X" }, { id: "bosse", label: "Bosse / impact", symbole: "O" }, { id: "eclat", label: "Éclat", symbole: "●" }];
  var VIEWS = [{ key: "left", label: "Profil conducteur", shape: "side" }, { key: "front", label: "Avant", shape: "front" }, { key: "right", label: "Profil passager", shape: "side", mirror: true }, { key: "rear", label: "Arrière", shape: "rear" }, { key: "top", label: "Dessus", shape: "top" }];
  var SHAPES = {
    car: {
      top: { w: 120, h: 220, p: [["r",15,10,90,200,26],["l",15,55,105,55],["l",15,165,105,165],["r",3,46,10,16,3],["r",107,46,10,16,3],["r",0,35,10,32,3],["r",110,35,10,32,3],["r",0,153,10,32,3],["r",110,153,10,32,3]] },
      side: { w: 220, h: 100, p: [["p",[[8,72],[8,52],[28,36],[54,20],[142,20],[168,36],[212,52],[212,72]]],["l",8,72,212,72],["l",96,26,96,72],["e",46,76,19,19],["e",174,76,19,19]] },
      front: { w: 140, h: 100, p: [["r",18,18,104,52,14],["l",18,32,122,32],["r",24,38,20,14,3],["r",96,38,20,14,3],["e",36,86,22,12],["e",104,86,22,12]] },
      rear: { w: 140, h: 100, p: [["r",18,18,104,52,14],["l",22,30,118,30],["r",20,40,16,20,3],["r",104,40,16,20,3],["e",36,86,22,12],["e",104,86,22,12]] }
    },
    utility: {
      top: { w: 120, h: 220, p: [["r",14,8,92,204,10],["l",14,50,106,50],["r",2,40,10,16,3],["r",108,40,10,16,3],["r",0,32,10,30,3],["r",110,32,10,30,3],["r",0,158,10,30,3],["r",110,158,10,30,3]] },
      side: { w: 220, h: 100, p: [["p",[[8,72],[8,34],[18,24],[46,24],[46,14],[204,14],[212,24],[212,72]]],["l",8,72,212,72],["l",46,24,46,72],["e",44,76,19,19],["e",176,76,19,19]] },
      front: { w: 140, h: 100, p: [["r",16,10,108,62,8],["l",16,26,124,26],["r",22,34,20,14,3],["r",98,34,20,14,3],["e",36,88,22,12],["e",104,88,22,12]] },
      rear: { w: 140, h: 100, p: [["r",16,10,108,62,8],["l",70,10,70,72],["e",36,88,22,12],["e",104,88,22,12]] }
    }
  };
  function svg(tag, attrs) { var el = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.keys(attrs).forEach(function (key) { el.setAttribute(key, attrs[key]); }); return el; }
  function outline(shape, family, mirror) {
    var spec = SHAPES[family === "utility" ? "utility" : "car"][shape], root = svg("svg", { viewBox: "0 0 " + spec.w + " " + spec.h, preserveAspectRatio: "xMidYMid meet" }), group = svg("g", mirror ? { transform: "translate(" + spec.w + ",0) scale(-1,1)" } : {});
    spec.p.forEach(function (part) { if (part[0] === "r") group.append(svg("rect", { x: part[1], y: part[2], width: part[3], height: part[4], rx: part[5] || 0 })); else if (part[0] === "e") group.append(svg("ellipse", { cx: part[1], cy: part[2], rx: part[3], ry: part[4] })); else if (part[0] === "l") group.append(svg("line", { x1: part[1], y1: part[2], x2: part[3], y2: part[4] })); else group.append(svg("polyline", { points: part[1].map(function (point) { return point.join(","); }).join(" ") })); });
    root.append(group); return root;
  }
  function normalize(marks) { return (Array.isArray(marks) ? marks : []).slice(0, 200).map(function (mark, index) { return { id: String(mark && mark.id || "m" + (index + 1)), view: VIEWS.some(function (view) { return view.key === (mark && mark.view); }) ? mark.view : "top", type: TYPES.some(function (type) { return type.id === (mark && mark.type); }) ? mark.type : "rayure", x: Math.max(0, Math.min(100, Number(mark && mark.x) || 0)), y: Math.max(0, Math.min(100, Number(mark && mark.y) || 0)) }; }); }
  global.createInspectionSketch = function (container, options) {
    options = options || {}; var marks = normalize(options.marks), family = options.family === "utility" ? "utility" : "car", current = "rayure", canvases = {};
    container.textContent = ""; container.classList.add("inspection-sketch");
    var tools = document.createElement("div"); tools.className = "inspection-sketch-tools";
    if (!options.readOnly) { TYPES.forEach(function (type) { var button = document.createElement("button"); button.type = "button"; button.textContent = type.symbole + " " + type.label; button.className = type.id === current ? "active" : ""; button.setAttribute("aria-pressed", type.id === current); button.onclick = function () { current = type.id; Array.prototype.forEach.call(tools.querySelectorAll("button"), function (item) { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", item === button); }); }; tools.append(button); }); container.append(tools); }
    var grid = document.createElement("div"); grid.className = "inspection-sketch-grid"; container.append(grid);
    function changed() { if (options.onChange) options.onChange(); }
    function redraw() {
      VIEWS.forEach(function (view) {
        var canvas = canvases[view.key], spec = SHAPES[family][view.shape], root = outline(view.shape, family, view.mirror);
        root.classList.add("inspection-sketch-outline"); root.dataset.view = view.key;
        root.setAttribute("aria-label", view.label); canvas.replaceChildren(root);
        marks.filter(function (mark) { return mark.view === view.key; }).forEach(function (mark) {
          var info = TYPES.find(function (type) { return type.id === mark.type; });
          var group = svg("g", { transform: "translate(" + mark.x * spec.w / 100 + "," + mark.y * spec.h / 100 + ")", "data-mark-id": mark.id, "data-x": mark.x, "data-y": mark.y });
          var symbol = svg("text", { x: 0, y: 0, "text-anchor": "middle", "dominant-baseline": "central", class: "inspection-sketch-symbol" }); symbol.textContent = info.symbole;
          group.append(symbol);
          if (!options.readOnly) {
            // Target is at least 44 screen pixels, while symbol/position share the silhouette's viewBox.
            var hit = Math.max(22, 44 * spec.w / Math.max(1, canvas.clientWidth || 180));
            group.append(svg("rect", { x: -hit / 2, y: -hit / 2, width: hit, height: hit, class: "inspection-sketch-hit" }));
            group.setAttribute("role", "button"); group.setAttribute("tabindex", "0"); group.setAttribute("aria-label", "Supprimer " + info.label + " — " + view.label);
            var remove = function (event) { event.stopPropagation(); marks = marks.filter(function (item) { return item.id !== mark.id; }); redraw(); changed(); };
            group.onclick = remove; group.onkeydown = function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); remove(event); } };
          }
          root.append(group);
        });
        if (!options.readOnly) root.onclick = function (event) {
          if (marks.length >= 200) return;
          // Map through the actual SVG coordinate system (including preserveAspectRatio).
          var point = root.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
          point = point.matrixTransform(root.getScreenCTM().inverse());
          marks.push({ id: "m" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), view: view.key, type: current, x: Math.max(0, Math.min(100, Math.round(point.x / spec.w * 1000) / 10)), y: Math.max(0, Math.min(100, Math.round(point.y / spec.h * 1000) / 10)) });
          redraw(); changed();
        };
      });
    }
    VIEWS.forEach(function (view) { var wrap = document.createElement("div"), label = document.createElement("strong"), canvas = document.createElement("div"); wrap.className = "inspection-sketch-view"; wrap.dataset.view = view.key; label.textContent = view.label; canvas.className = "inspection-sketch-canvas"; wrap.append(label, canvas); grid.append(wrap); canvases[view.key] = canvas; });
    redraw();
    if (!options.readOnly && global.ResizeObserver) { new ResizeObserver(function () { redraw(); }).observe(container); }
    return { getMarks: function () { return normalize(marks); }, setMarks: function (value) { marks = normalize(value); redraw(); } };
  };
}(window));

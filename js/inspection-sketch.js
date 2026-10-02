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
    options = options || {}; var marks = normalize(options.marks), family = options.family === "utility" ? "utility" : "car", current = "rayure", next = marks.length + 1, canvases = {};
    container.textContent = ""; container.classList.add("inspection-sketch");
    var tools = document.createElement("div"); tools.className = "inspection-sketch-tools";
    TYPES.forEach(function (type) { var button = document.createElement("button"); button.type = "button"; button.textContent = type.symbole + " " + type.label; button.className = type.id === current ? "active" : ""; button.onclick = function () { current = type.id; Array.prototype.forEach.call(tools.querySelectorAll("button"), function (item) { item.classList.toggle("active", item === button); }); }; tools.append(button); }); container.append(tools);
    var grid = document.createElement("div"); grid.className = "inspection-sketch-grid"; container.append(grid);
    function redraw() { VIEWS.forEach(function (view) { var canvas = canvases[view.key]; canvas.textContent = ""; canvas.append(outline(view.shape, family, view.mirror)); marks.filter(function (mark) { return mark.view === view.key; }).forEach(function (mark) { var info = TYPES.filter(function (type) { return type.id === mark.type; })[0], button = document.createElement("button"); button.type = "button"; button.className = "inspection-sketch-mark " + mark.type; button.style.left = mark.x + "%"; button.style.top = mark.y + "%"; button.textContent = info.symbole; button.title = info.label + " — cliquer pour supprimer"; button.onclick = function (event) { event.stopPropagation(); marks = marks.filter(function (item) { return item.id !== mark.id; }); redraw(); }; canvas.append(button); }); }); }
    VIEWS.forEach(function (view) { var wrap = document.createElement("div"), label = document.createElement("strong"), canvas = document.createElement("div"), dimensions = SHAPES[family][view.shape]; wrap.className = "inspection-sketch-view"; label.textContent = view.label; canvas.className = "inspection-sketch-canvas"; canvas.style.aspectRatio = dimensions.w + " / " + dimensions.h; canvas.onclick = function (event) { var rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; marks.push({ id: "m" + next++, view: view.key, type: current, x: Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10, y: Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10 }); redraw(); }; wrap.append(label, canvas); grid.append(wrap); canvases[view.key] = canvas; });
    redraw(); return { getMarks: function () { return normalize(marks); }, setMarks: function (value) { marks = normalize(value); next = marks.length + 1; redraw(); } };
  };
}(window));

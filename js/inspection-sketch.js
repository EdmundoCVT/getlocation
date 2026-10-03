// Croquis autonome : les cinq vues proviennent du schéma de référence fourni
// par GET LOCATION. Les marques gardent le format historique {id, view, x, y,
// type} ; `description` est facultative afin que les anciens dossiers restent
// parfaitement lisibles.
(function (global) {
  "use strict";
  var TYPES = [{ id: "rayure", label: "Rayure", symbole: "X" }, { id: "bosse", label: "Bosse / impact", symbole: "O" }, { id: "eclat", label: "Éclat", symbole: "●" }];
  var VIEWS = [
    { key: "left", label: "Profil conducteur", asset: "/images/inspection/vehicle-left.png" },
    { key: "front", label: "Avant", asset: "/images/inspection/vehicle-front.png" },
    { key: "right", label: "Profil passager", asset: "/images/inspection/vehicle-right.png" },
    { key: "rear", label: "Arrière", asset: "/images/inspection/vehicle-rear.png" },
    { key: "top", label: "Dessus", asset: "/images/inspection/vehicle-top.png" }
  ];
  function number(value, fallback) { value = Number(value); return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value * 10) / 10)) : fallback; }
  function normalize(marks) {
    return (Array.isArray(marks) ? marks : []).slice(0, 200).map(function (mark, index) {
      return {
        id: String(mark && mark.id || "m" + (index + 1)),
        view: VIEWS.some(function (view) { return view.key === (mark && mark.view); }) ? mark.view : "top",
        type: TYPES.some(function (type) { return type.id === (mark && mark.type); }) ? mark.type : "rayure",
        x: number(mark && mark.x, 0), y: number(mark && mark.y, 0),
        description: typeof (mark && mark.description) === "string" ? mark.description.slice(0, 500) : ""
      };
    });
  }
  function typeFor(mark) { return TYPES.find(function (type) { return type.id === mark.type; }) || TYPES[0]; }
  function labelFor(viewKey) { var view = VIEWS.find(function (item) { return item.key === viewKey; }); return view ? view.label : viewKey; }
  global.InspectionSketch = { VIEWS: VIEWS, TYPES: TYPES, labelFor: labelFor };
  global.createInspectionSketch = function (container, options) {
    options = options || {};
    var marks = normalize(options.marks), current = "rayure", canvases = {};
    container.replaceChildren(); container.classList.add("inspection-sketch");
    function changed() { if (options.onChange) options.onChange(); }
    function remove(id) { marks = marks.filter(function (mark) { return mark.id !== id; }); redraw(); changed(); }
    function redraw() {
      VIEWS.forEach(function (view) {
        var canvas = canvases[view.key];
        canvas.replaceChildren();
        var image = new Image(); image.className = "inspection-reference-image"; image.alt = view.label + " — schéma véhicule"; image.src = new URL(view.asset, global.location.href).href;
        image.draggable = false; canvas.append(image);
        marks.filter(function (mark) { return mark.view === view.key; }).forEach(function (mark) {
          var info = typeFor(mark), index = marks.indexOf(mark) + 1, marker = document.createElement("button"), no = document.createElement("span"), symbol = document.createElement("span");
          marker.type = "button"; marker.className = "inspection-sketch-mark " + mark.type; marker.dataset.markId = mark.id; marker.dataset.x = mark.x; marker.dataset.y = mark.y;
          marker.style.left = mark.x + "%"; marker.style.top = mark.y + "%"; marker.title = "Repère " + index + " — " + info.label + " — " + view.label + (mark.description ? " : " + mark.description : "");
          no.className = "inspection-sketch-mark-number"; no.textContent = index; symbol.className = "inspection-sketch-mark-symbol"; symbol.textContent = info.symbole; marker.append(no, symbol);
          if (options.readOnly) { marker.disabled = true; marker.setAttribute("aria-label", marker.title); }
          else { marker.setAttribute("aria-label", "Supprimer " + marker.title); marker.onclick = function (event) { event.stopPropagation(); remove(mark.id); }; }
          canvas.append(marker);
        });
      });
    }
    if (!options.readOnly) {
      var tools = document.createElement("div"); tools.className = "inspection-sketch-tools";
      TYPES.forEach(function (type) {
        var button = document.createElement("button"); button.type = "button"; button.textContent = type.symbole + " " + type.label; button.className = type.id === current ? "active" : ""; button.setAttribute("aria-pressed", type.id === current);
        button.onclick = function () { current = type.id; Array.prototype.forEach.call(tools.querySelectorAll("button"), function (item) { var active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-pressed", active); }); };
        tools.append(button);
      });
      container.append(tools);
    }
    var grid = document.createElement("div"); grid.className = "inspection-sketch-grid"; container.append(grid);
    VIEWS.forEach(function (view) {
      var wrap = document.createElement("section"), label = document.createElement("h3"), canvas = document.createElement("div");
      wrap.className = "inspection-sketch-view"; wrap.dataset.view = view.key; label.textContent = view.label; canvas.className = "inspection-sketch-canvas"; canvas.dataset.view = view.key;
      if (!options.readOnly) canvas.onclick = function (event) {
        if (event.target.closest(".inspection-sketch-mark") || marks.length >= 200) return;
        var rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        marks.push({ id: "m" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), view: view.key, type: current, x: number((event.clientX - rect.left) / rect.width * 100, 0), y: number((event.clientY - rect.top) / rect.height * 100, 0), description: "" });
        redraw(); changed();
      };
      wrap.append(label, canvas); grid.append(wrap); canvases[view.key] = canvas;
    });
    redraw();
    return {
      getMarks: function () { return normalize(marks); },
      setMarks: function (value) { marks = normalize(value); redraw(); },
      setDescription: function (id, description) { marks = marks.map(function (mark) { return mark.id === id ? Object.assign({}, mark, { description: String(description || "").slice(0, 500) }) : mark; }); changed(); },
      getMark: function (id) { return marks.find(function (mark) { return mark.id === id; }) || null; }
    };
  };
}(window));

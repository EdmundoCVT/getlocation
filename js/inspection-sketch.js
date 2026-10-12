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
  var UTILITY_SURFACES = [
    { key: "utility-exterior", label: "Extérieur", asset: "/images/inspection/utility-exterior.png" },
    { key: "utility-interior", label: "Intérieur", asset: "/images/inspection/utility-interior.png" }
  ];
  function number(value, fallback) { value = Number(value); return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value * 10) / 10)) : fallback; }
  function normalize(marks, vehicleType) {
    var surfaces = vehicleType === "utility" ? UTILITY_SURFACES : VIEWS;
    return (Array.isArray(marks) ? marks : []).slice(0, 200).map(function (mark, index) {
      var key = vehicleType === "utility" ? mark && mark.surface : mark && mark.view;
      var fallback = vehicleType === "utility" ? "utility-exterior" : "top";
      return {
        id: String(mark && mark.id || "m" + (index + 1)),
        view: vehicleType === "utility" ? undefined : (surfaces.some(function (view) { return view.key === key; }) ? key : fallback),
        surface: vehicleType === "utility" ? (surfaces.some(function (view) { return view.key === key; }) ? key : fallback) : undefined,
        type: TYPES.some(function (type) { return type.id === (mark && mark.type); }) ? mark.type : "rayure",
        x: number(mark && mark.x, 0), y: number(mark && mark.y, 0),
        description: typeof (mark && mark.description) === "string" ? mark.description.slice(0, 500) : ""
      };
    });
  }
  function typeFor(mark) { return TYPES.find(function (type) { return type.id === mark.type; }) || TYPES[0]; }
  function labelFor(viewKey) { var view = VIEWS.concat(UTILITY_SURFACES).find(function (item) { return item.key === viewKey; }); return view ? view.label : viewKey; }
  global.InspectionSketch = { VIEWS: VIEWS, UTILITY_SURFACES: UTILITY_SURFACES, TYPES: TYPES, labelFor: labelFor };
  global.createInspectionSketch = function (container, options) {
    options = options || {};
    var vehicleType = options.vehicleType === "utility" ? "utility" : "car", surfaces = vehicleType === "utility" ? UTILITY_SURFACES : VIEWS;
    var marks = normalize(options.marks, vehicleType), current = "rayure", canvases = {};
    function markSurface(mark) { return vehicleType === "utility" ? mark.surface : mark.view; }
    container.replaceChildren(); container.classList.add("inspection-sketch");
    function changed(reason) { if (options.onChange) options.onChange(reason); }
    function remove(id) { marks = marks.filter(function (mark) { return mark.id !== id; }); redraw(); changed(); }
    function redraw() {
      surfaces.forEach(function (view) {
        var canvas = canvases[view.key];
        canvas.replaceChildren();
        var image = new Image(); image.className = "inspection-reference-image"; image.alt = view.label + " — schéma véhicule"; image.src = new URL(view.asset, global.location.href).href;
        image.draggable = false; canvas.append(image);
        marks.filter(function (mark) { return markSurface(mark) === view.key; }).forEach(function (mark) {
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
    surfaces.forEach(function (view) {
      var wrap = document.createElement("section"), label = document.createElement("h3"), canvas = document.createElement("div");
      wrap.className = "inspection-sketch-view"; wrap.dataset.view = view.key; label.textContent = view.label; canvas.className = "inspection-sketch-canvas"; canvas.dataset.view = view.key;
      if (!options.readOnly) canvas.onclick = function (event) {
        if (event.target.closest(".inspection-sketch-mark") || marks.length >= 200) return;
        var rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        var mark = { id: "m" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), type: current, x: number((event.clientX - rect.left) / rect.width * 100, 0), y: number((event.clientY - rect.top) / rect.height * 100, 0), description: "" };
        if (vehicleType === "utility") mark.surface = view.key; else mark.view = view.key;
        marks.push(mark);
        redraw(); changed();
      };
      wrap.append(label, canvas);
      if (vehicleType === "utility" && options.onExpand) { var zoom = document.createElement("button"); zoom.type = "button"; zoom.className = "inspection-sketch-zoom"; zoom.textContent = "Agrandir"; zoom.onclick = function () { options.onExpand(view); }; wrap.append(zoom); }
      grid.append(wrap); canvases[view.key] = canvas;
    });
    redraw();
    return {
      getMarks: function () { return normalize(marks, vehicleType); },
      setMarks: function (value) { marks = normalize(value, vehicleType); redraw(); },
      setDescription: function (id, description) {
        marks = marks.map(function (mark) { return mark.id === id ? Object.assign({}, mark, { description: String(description || "").slice(0, 500) }) : mark; });
        var mark = marks.find(function (item) { return item.id === id; });
        if (mark) Array.prototype.forEach.call(container.querySelectorAll(".inspection-sketch-mark"), function (node) {
          if (node.dataset.markId !== id) return;
          var info = typeFor(mark);
          node.title = "Repère " + (marks.indexOf(mark) + 1) + " — " + info.label + " — " + labelFor(markSurface(mark)) + (mark.description ? " : " + mark.description : "");
        });
        changed("description");
      },
      getMark: function (id) { return marks.find(function (mark) { return mark.id === id; }) || null; }
    };
  };
}(window));

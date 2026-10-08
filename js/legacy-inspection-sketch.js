// Lecteur historique en lecture seule. Il ne transforme jamais les marques
// stockées : il les superpose aux mêmes cinq vues détaillées que l'interface
// d'inspection active. Aucun SVG de silhouette n'est généré ici.
(function (global) {
  "use strict";
  var views = [
    { key: "left", label: "Profil conducteur", asset: "/images/inspection/vehicle-left.png" },
    { key: "front", label: "Avant", asset: "/images/inspection/vehicle-front.png" },
    { key: "right", label: "Profil passager", asset: "/images/inspection/vehicle-right.png" },
    { key: "rear", label: "Arrière", asset: "/images/inspection/vehicle-rear.png" },
    { key: "top", label: "Dessus", asset: "/images/inspection/vehicle-top.png" }
  ];
  var symbols = { rayure: "X", bosse: "O", impact: "O", eclat: "●" };
  function normalizedView(view) { return view === "side" ? "left" : view; }
  function coordinate(value) { value = Number(value); return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0; }
  global.renderLegacyInspectionSketch = function (container, marks) {
    if (!container) return;
    container.replaceChildren(); container.className = "legacy-sketch-grid";
    var list = Array.isArray(marks) ? marks : [];
    views.forEach(function (view) {
      var pane = document.createElement("section"), label = document.createElement("h3"), canvas = document.createElement("div"), image = new Image();
      pane.className = "legacy-sketch-view"; pane.dataset.view = view.key; label.textContent = view.label;
      canvas.className = "legacy-sketch-canvas"; canvas.dataset.view = view.key;
      image.className = "legacy-reference-image"; image.src = new URL(view.asset, global.location.href).href; image.alt = view.label + " — schéma véhicule"; image.draggable = false;
      canvas.append(image);
      list.filter(function (mark) { return normalizedView(mark && mark.view) === view.key; }).forEach(function (mark, index) {
        var point = document.createElement("span"), symbol = symbols[mark && mark.type] || "•";
        point.className = "legacy-sketch-mark legacy-sketch-" + (mark && mark.type || "rayure"); point.textContent = (index + 1) + symbol;
        point.style.left = coordinate(mark && mark.x) + "%"; point.style.top = coordinate(mark && mark.y) + "%";
        point.title = mark && mark.description ? mark.description : (mark && mark.type || "Dommage"); point.setAttribute("aria-label", "Repère historique " + (index + 1) + " : " + point.title);
        canvas.append(point);
      });
      pane.append(label, canvas); container.append(pane);
    });
  };
}(window));

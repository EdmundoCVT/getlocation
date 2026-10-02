// Rendu lecture seule des croquis historiques d'état des lieux.
// Il réutilise le format existant { view, x, y, type } du schéma contrat.
(function(global){
  "use strict";
  var views=[
    {key:"left",label:"Profil conducteur",shape:"side"},
    {key:"front",label:"Avant",shape:"front"},
    {key:"right",label:"Profil passager",shape:"side"},
    {key:"rear",label:"Arrière",shape:"rear"},
    {key:"top",label:"Dessus",shape:"top"}
  ];
  var symbols={rayure:"X",bosse:"O",eclat:"●",impact:"O"};
  function svg(tag,attrs){var el=document.createElementNS("http://www.w3.org/2000/svg",tag);Object.keys(attrs||{}).forEach(function(k){el.setAttribute(k,attrs[k]);});return el;}
  function vehicleShape(shape){
    var s=svg("svg",{viewBox:"0 0 100 100",preserveAspectRatio:"xMidYMid meet","aria-hidden":"true"});
    var outline=svg("path",{d:shape==="top"?"M37 5h26l12 16v58L63 95H37L25 79V21z M31 37h38 M31 65h38":shape==="side"?"M8 68V52l16-16 18-9h26l18 12 8 17v12H8z M34 68a9 9 0 1 0 0 .1 M76 68a9 9 0 1 0 0 .1 M40 37v28 M62 31v34":"M20 75V34l13-17h34l13 17v41H20z M31 35h38 M26 54h48","class":"legacy-sketch-outline"});
    s.appendChild(outline);return s;
  }
  function normalizeView(view){return view==="side"?"left":view;}
  global.renderLegacyInspectionSketch=function(container,marks){
    if(!container)return;
    container.textContent="";
    container.className="legacy-sketch-grid";
    var normalized=Array.isArray(marks)?marks:[];
    views.forEach(function(view){
      var pane=document.createElement("div");pane.className="legacy-sketch-view";
      var label=document.createElement("strong");label.textContent=view.label;pane.appendChild(label);
      var canvas=document.createElement("div");canvas.className="legacy-sketch-canvas";canvas.appendChild(vehicleShape(view.shape));
      normalized.filter(function(mark){return normalizeView(mark&&mark.view)===view.key;}).forEach(function(mark){
        var x=Math.max(0,Math.min(100,Number(mark.x)||0)),y=Math.max(0,Math.min(100,Number(mark.y)||0));
        var point=document.createElement("span");point.className="legacy-sketch-mark legacy-sketch-"+(mark.type||"rayure");point.textContent=symbols[mark.type]||"•";point.style.left=x+"%";point.style.top=y+"%";point.title=mark.type||"Dommage";canvas.appendChild(point);
      });
      pane.appendChild(canvas);container.appendChild(pane);
    });
  };
})(window);

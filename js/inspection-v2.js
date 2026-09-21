// js/inspection-v2.js — état des lieux mobile GET LOCATION
(function(){
"use strict";
var hash=new URLSearchParams((location.hash||"").replace(/^#/,""));
var token=hash.get("agencyToken");
if(!token)return;
var AUTH={"Authorization":"Bearer "+token};
var labels={avant:"Avant",arriere:"Arrière",gauche:"Côté gauche",droite:"Côté droit","avant-gauche":"3/4 avant gauche","avant-droit":"3/4 avant droit","arriere-gauche":"3/4 arrière gauche","arriere-droit":"3/4 arrière droit",interieur:"Intérieur",jante:"Jante / roue",dommage:"Détail dommage",autre:"Autre"};
var slots=["avant","arriere","gauche","droite","avant-gauche","avant-droit","arriere-gauche","arriere-droit","interieur","jante","dommage"];
var media={depart:[],retour:[]};

function css(){
 var s=document.createElement("style");s.textContent=
 ".gl-inspect{margin:12px 0;padding:14px;border:1px solid #e7e7ea;border-radius:16px;background:#fafafa}.gl-inspect h4{margin:0 0 6px;font-size:15px}.gl-inspect-note{font-size:12px;color:#777;margin:0 0 10px}.gl-shot-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.gl-shot{position:relative;min-height:78px;border:1px dashed #cfd1d6;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;font-size:12px;overflow:hidden}.gl-shot input{position:absolute;inset:0;opacity:0;cursor:pointer}.gl-shot img{width:100%;height:92px;object-fit:cover;border-radius:9px}.gl-shot .gl-shot-label{position:absolute;left:5px;bottom:5px;background:rgba(0,0,0,.68);color:#fff;padding:3px 6px;border-radius:6px;font-size:10px}.gl-zone-wrap{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.gl-zone{border:1px solid #ddd;background:#fff;border-radius:999px;padding:7px 10px;font-size:12px}.gl-uploading{opacity:.5;pointer-events:none}.gl-compare{margin-top:12px;padding-top:10px;border-top:1px solid #eee}.gl-compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gl-compare img{width:100%;height:110px;object-fit:cover;border-radius:10px}@media(min-width:700px){.gl-shot-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}";
 document.head.appendChild(s);
}
function api(url,opts){opts=opts||{};opts.headers=Object.assign({},AUTH,opts.headers||{});return fetch(url,opts);}
async function imageUrl(key){var r=await api("/api/inspection-media?key="+encodeURIComponent(key));if(!r.ok)return"";return URL.createObjectURL(await r.blob());}
function latest(stage,slot){var a=(media[stage]||[]).filter(function(x){return x.slot===slot});return a[a.length-1]||null;}
async function renderSlot(box,stage,slot){
 box.innerHTML="";
 var item=latest(stage,slot);
 if(item){var img=document.createElement("img");img.alt=labels[slot];var u=await imageUrl(item.key);if(u)img.src=u;box.appendChild(img);}
 else {var t=document.createElement("span");t.textContent="+ "+labels[slot];box.appendChild(t);}
 var lab=document.createElement("span");lab.className="gl-shot-label";lab.textContent=labels[slot];if(item)box.appendChild(lab);
 var input=document.createElement("input");input.type="file";input.accept="image/*";input.setAttribute("capture","environment");
 input.addEventListener("change",async function(){if(!input.files||!input.files[0])return;box.classList.add("gl-uploading");var fd=new FormData();fd.append("stage",stage);fd.append("slot",slot);fd.append("file",input.files[0]);try{var r=await api("/api/inspection-media",{method:"POST",body:fd});var j=await r.json();if(!r.ok)throw new Error(j.error||"Envoi impossible");media[stage].push(j.item);await renderSlot(box,stage,slot);renderCompare();}catch(e){alert(e.message);}finally{box.classList.remove("gl-uploading");}});
 box.appendChild(input);
}
function addDamageZones(stage,root){
 var ta=document.getElementById("rr-"+stage+"-dommages");if(!ta)return;
 var wrap=document.createElement("div");wrap.className="gl-zone-wrap";
 ["Avant","Arrière","Côté G","Côté D","Pare-brise","Jante AVG","Jante AVD","Jante ARG","Jante ARD","Intérieur"].forEach(function(z){var b=document.createElement("button");b.type="button";b.className="gl-zone";b.textContent="+ "+z;b.onclick=function(){var prefix=ta.value.trim()?ta.value.trim()+"\n":"";ta.value=prefix+"["+z+"] ";ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);};wrap.appendChild(b);});
 root.appendChild(wrap);
}
function enhance(stage){
 var ref=document.getElementById("rr-"+stage+"-photosRef");if(!ref||document.getElementById("gl-inspect-"+stage))return;
 ref.closest("td")&& (ref.style.display="none");
 var box=document.createElement("div");box.id="gl-inspect-"+stage;box.className="gl-inspect";
 box.innerHTML="<h4>Photos "+(stage==="depart"?"au départ":"au retour")+"</h4><p class='gl-inspect-note'>Prenez les vues standardisées. Ajoutez ensuite des gros plans pour chaque dommage.</p>";
 var grid=document.createElement("div");grid.className="gl-shot-grid";box.appendChild(grid);
 slots.forEach(function(slot){var s=document.createElement("div");s.className="gl-shot";grid.appendChild(s);renderSlot(s,stage,slot);});
 addDamageZones(stage,box);
 ref.parentNode.appendChild(box);
}
async function renderCompare(){
 var old=document.getElementById("gl-inspection-compare");if(old)old.remove();
 if(!media.depart.length||!media.retour.length)return;
 var anchor=document.getElementById("gl-inspect-retour");if(!anchor)return;
 var box=document.createElement("div");box.id="gl-inspection-compare";box.className="gl-inspect gl-compare";box.innerHTML="<h4>Comparaison départ ↔ retour</h4><p class='gl-inspect-note'>Contrôle visuel rapide des mêmes angles. La décision de dommage reste humaine.</p>";
 var grid=document.createElement("div");grid.className="gl-compare-grid";box.appendChild(grid);
 for(const slot of ["avant","arriere","gauche","droite"]){var d=latest("depart",slot),r=latest("retour",slot);if(!d||!r)continue;for(const pair of [[d,"Départ · "],[r,"Retour · "]]){var cell=document.createElement("div");var img=document.createElement("img");img.alt=pair[1]+labels[slot];var u=await imageUrl(pair[0].key);if(u)img.src=u;var p=document.createElement("small");p.textContent=pair[1]+labels[slot];cell.append(img,p);grid.appendChild(cell);}}
 anchor.parentNode.insertBefore(box,anchor.nextSibling);
}
async function init(){
 css();enhance("depart");enhance("retour");
 try{var r=await api("/api/contract-dossier-agency");if(r.ok){var j=await r.json();media=(j.dossier&&j.dossier.media)||media;enhance("depart");enhance("retour");document.querySelectorAll(".gl-shot-grid").forEach(function(g){g.innerHTML="";});["depart","retour"].forEach(function(stage){var g=document.querySelector("#gl-inspect-"+stage+" .gl-shot-grid");if(g)slots.forEach(function(slot){var s=document.createElement("div");s.className="gl-shot";g.appendChild(s);renderSlot(s,stage,slot);});});renderCompare();}}catch(e){}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(init,250)});else setTimeout(init,250);
})();
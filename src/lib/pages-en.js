// src/lib/pages-en.js
//
// Service des pages anglaises (/en/cars, /en/booking…). Une page = un seul
// fichier HTML, écrit en français et servi tel quel sous son URL française ;
// sous /en/, le même fichier est renvoyé avec ses métadonnées traduites, la
// traduction du contenu visible étant faite au chargement par js/i18n.js.
//
// Pourquoi traduire les métadonnées ICI plutôt que dans le navigateur : le
// titre, la description et l'URL canonique doivent être corrects pour un
// moteur de recherche qui n'exécute pas le JavaScript. Le reste de la page
// (textes visibles) peut, lui, être traduit côté client sans conséquence
// pour le référencement, puisque Google exécute le JS.
//
// Les URLs françaises ne passent jamais par ce module : elles continuent
// d'être servies directement par le binding ASSETS, sans transformation.

const { SLUGS_EN, FICHIERS_PAR_SLUG, SEO, PAGES_JURIDIQUES } = require("../../js/i18n.js");

const SITE = "https://getlocation.fr";

function estCheminAnglais(pathname) {
  return /^\/en(\/|$)/.test(pathname || "");
}

// "/en/cars" -> "vehicules.html" ; null si l'adresse anglaise n'existe pas
// (le 404 reste alors géré par le service des fichiers statiques).
function fichierPourCheminAnglais(pathname) {
  if (!estCheminAnglais(pathname)) return null;
  const slug = String(pathname).replace(/^\/en\/?/, "").replace(/\/$/, "");
  return Object.prototype.hasOwnProperty.call(FICHIERS_PAR_SLUG, slug) ? FICHIERS_PAR_SLUG[slug] : null;
}

function urlAnglaise(fichier) {
  const slug = SLUGS_EN[fichier];
  return `${SITE}/en/${slug}`.replace(/\/$/, slug === "" ? "/" : "");
}

function urlFrancaise(fichier) {
  return fichier === "index.html" ? `${SITE}/` : `${SITE}/${fichier}`;
}

function echapperAttribut(valeur) {
  return String(valeur).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Remplace une balise <meta ... content="..."> en ne touchant qu'à son
// attribut content (le reste de la balise est conservé intact).
function remplacerMeta(html, attribut, valeur, contenu) {
  const motif = new RegExp(
    `(<meta\\s+[^>]*${attribut}=["']${valeur}["'][^>]*content=["'])([^"']*)(["'])`,
    "i"
  );
  if (motif.test(html)) return html.replace(motif, `$1${echapperAttribut(contenu)}$3`);
  // Ordre inverse des attributs (content avant name/property).
  const motifInverse = new RegExp(
    `(<meta\\s+[^>]*content=["'])([^"']*)(["'][^>]*${attribut}=["']${valeur}["'])`,
    "i"
  );
  return html.replace(motifInverse, `$1${echapperAttribut(contenu)}$3`);
}

// Les pages sont écrites avec des chemins RELATIFS ("css/style.css",
// "images/logo.png") : corrects à la racine du site, ils se résoudraient en
// "/en/css/style.css" sous une adresse anglaise, et donc en 404. Toutes les
// ressources sont donc rendues absolues avant d'être servies sous /en/.
const DEJA_ABSOLU = /^(https?:|tel:|mailto:|data:|#|\/\/|\/)/i;

function absolutiser(valeur) {
  const url = String(valeur).trim();
  if (!url || DEJA_ABSOLU.test(url)) return valeur;
  return "/" + url.replace(/^\.\//, "");
}

// srcset : "image-700.webp 700w, image-1400.webp 1400w"
function absolutiserSrcset(valeur) {
  return String(valeur)
    .split(",")
    .map((entree) => {
      const morceaux = entree.trim().split(/\s+/);
      if (!morceaux[0]) return entree;
      morceaux[0] = absolutiser(morceaux[0]);
      return morceaux.join(" ");
    })
    .join(", ");
}

// Liens internes : pointent directement vers la version anglaise, pour que
// la navigation fonctionne même avant l'exécution du JavaScript (et pour
// qu'un moteur de recherche explore bien les pages anglaises entre elles).
function lienAnglais(href) {
  const valeur = String(href);
  if (DEJA_ABSOLU.test(valeur) && !valeur.startsWith("/")) return valeur;
  const separateur = valeur.search(/[?#]/);
  const chemin = (separateur === -1 ? valeur : valeur.slice(0, separateur)).replace(/^\//, "");
  const suite = separateur === -1 ? "" : valeur.slice(separateur);
  if (!chemin) return valeur;
  if (!Object.prototype.hasOwnProperty.call(SLUGS_EN, chemin)) return absolutiser(valeur);
  return `/en/${SLUGS_EN[chemin]}${suite}`;
}

function reecrireRessources(html) {
  let sortie = html;
  // src= (scripts, images, sources) et srcset= : jamais portés par un <a>.
  sortie = sortie.replace(/(\ssrc=")([^"]+)(")/gi, (_, avant, url, apres) => avant + absolutiser(url) + apres);
  sortie = sortie.replace(/(\ssrcset=")([^"]+)(")/gi, (_, avant, url, apres) => avant + absolutiserSrcset(url) + apres);
  // href= des <link> (feuilles de style, icônes) — les <link rel=alternate>
  // et rel=canonical sont déjà des URL absolues, absolutiser() les ignore.
  sortie = sortie.replace(/(<link\b[^>]*?\shref=")([^"]+)(")/gi, (_, avant, url, apres) => avant + absolutiser(url) + apres);
  // href= des <a> : basculés vers leur adresse anglaise.
  sortie = sortie.replace(/<a\b[^>]*>/gi, (baliseA) =>
    baliseA.replace(/(\shref=")([^"]+)(")/i, (_, avant, url, apres) => avant + lienAnglais(url) + apres)
  );
  return sortie;
}

// Transforme le HTML français en sa version anglaise : langue du document,
// titre, description, métadonnées de partage, URL canonique et chemins.
function traduireEnTete(html, fichier) {
  const seo = SEO[fichier];
  if (!seo) return html;
  let sortie = html;

  sortie = sortie.replace(/<html\s+lang=["']fr["']/i, '<html lang="en"');
  sortie = sortie.replace(/<title>[\s\S]*?<\/title>/i, `<title>${echapperAttribut(seo.titre)}</title>`);

  sortie = remplacerMeta(sortie, "name", "description", seo.description);
  sortie = remplacerMeta(sortie, "property", "og:title", seo.titre);
  sortie = remplacerMeta(sortie, "property", "og:description", seo.description);
  sortie = remplacerMeta(sortie, "property", "og:url", urlAnglaise(fichier));
  sortie = remplacerMeta(sortie, "property", "og:locale", "en_GB");
  sortie = remplacerMeta(sortie, "name", "twitter:title", seo.titre);
  sortie = remplacerMeta(sortie, "name", "twitter:description", seo.description);

  // Canonique : chaque version pointe sur elle-même, les deux se déclarant
  // l'une l'autre via les balises hreflang déjà présentes dans le fichier.
  sortie = sortie.replace(
    /(<link\s+rel=["']canonical["']\s+href=["'])([^"']*)(["'])/i,
    `$1${echapperAttribut(urlAnglaise(fichier))}$3`
  );

  return reecrireRessources(sortie);
}

// Sert la page anglaise correspondant à l'URL demandée, ou null si cette
// URL n'est pas une page anglaise connue (le routage normal reprend alors).
async function servirPageAnglaise(request, env, url) {
  const fichier = fichierPourCheminAnglais(url.pathname);
  if (!fichier) return null;

  const cible = new URL(request.url);
  cible.pathname = `/${fichier}`;
  const reponse = await env.ASSETS.fetch(new Request(cible.toString(), request));
  if (!reponse.ok) return reponse;

  const html = await reponse.text();
  const entetes = new Headers(reponse.headers);
  entetes.set("Content-Language", "en");
  return new Response(traduireEnTete(html, fichier), { status: reponse.status, headers: entetes });
}

module.exports = {
  estCheminAnglais,
  absolutiser,
  lienAnglais,
  reecrireRessources,
  fichierPourCheminAnglais,
  urlAnglaise,
  urlFrancaise,
  traduireEnTete,
  servirPageAnglaise,
  PAGES_JURIDIQUES
};

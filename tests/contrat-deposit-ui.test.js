const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('contrat.html', 'utf8');
async function page(state) {
  const dom = new JSDOM(html, { url: 'https://getlocation.fr/contrat', runScripts: 'outside-only' });
  const w = dom.window, calls = [];
  w.scrollTo = () => {};
  w.confirm = () => true;
  w.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('contracts-history')) return { ok: true, json: async () => ({ contracts: [{ id: 'res_test', numero: 'GL-TEST', origine: 'manuel', rawData: { vehiculeId: 'opel-corsa', nom: 'Test', prenom: 'Local', depositAmount: 512.34, defaultDepositAmount: 650 } }] }) };
    if (url.includes('agency-deposit-authorizations')) return { ok: true, json: async () => state };
    return { ok: false, json: async () => ({}) };
  };


  const script = [...w.document.querySelectorAll('script')].find(s => s.textContent.includes('function initOwnerView'));
  w.eval(fs.readFileSync('js/data.js', 'utf8') + '\n' + fs.readFileSync('js/contrat-en.js', 'utf8') + '\n' + script.textContent);
  w.initOwnerView();
  await new Promise(r => setTimeout(r, 0));
  return { w, calls, dom };
}
test('/contrat: agency custom amount; reopening restores snapshot, LIVE status and checkout; capture is explicit', async () => {
  const state = { configured: true, mollieTestMode: false, depositAmount: 512.34, active: { id: 'depauth_test', status: 'autorisee', mollieStatus: 'authorized', authorizedAmountCents: 51234, capturedAmountCents: 0, captureBefore: '2027-10-07T10:00:00Z', checkoutUrl: 'https://www.mollie.com/checkout/fake', testMode: false }, history: [] };
  const { w, calls, dom } = await page(state);
  const $ = id => w.document.getElementById(id);
  $('depositAmount').value = '432.10';
  $('depositAmount').dispatchEvent(new w.Event('change'));
  assert.equal($('depositAmount').value, '432.1');
  [...w.document.querySelectorAll('button')].find(b => b.textContent === 'Ouvrir').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal($('depositAmount').value, '512.34');
  assert.equal($('depositAmount').disabled, true);
  assert.match($('depositStatus').textContent, /MODE LIVE/);
  assert.match($('depositStatus').textContent, /07\/10\/2027/);
  assert.equal($('depositLink').value, state.active.checkoutUrl);
  assert.equal($('depositCapture').disabled, false);
  w.confirm = () => false;
  $('depositCapture').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls.filter(c => c.options.method === 'POST' && c.url.includes('agency-deposit-authorizations')).length, 0);
  w.confirm = () => true;
  $('depositCaptureAmount').value = '180';
  $('depositCapture').click();
  await new Promise(r => setTimeout(r, 0));
  const sent = calls.find(c => c.options.method === 'POST' && c.url.includes('agency-deposit-authorizations'));
  assert.equal(JSON.parse(sent.options.body).amount, 180);
  assert.equal(JSON.parse(sent.options.body).action, 'capture');
  dom.window.close();
});
test('/contrat: la saisie au clavier de 50 € ne revient pas au montant par défaut', async () => {
  const { w, dom } = await page({ configured: true, mollieTestMode: false, active: null, history: [], depositAmount: 650 });
  const input = w.document.getElementById('depositAmount');
  input.value = '';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(input.value, '');
  input.value = '5';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(input.value, '5');
  input.value = '50';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(input.value, '50');
  assert.match(w.document.getElementById('depositStatus').textContent, /Montant enregistré : 50/);
  dom.window.close();
});
test('/contrat: unconfigured key disables create and labels no LIVE mode', async () => {
  const { w, dom } = await page({ configured: false, active: null, history: [], depositAmount: 650 });
  [...w.document.querySelectorAll('button')].find(b => b.textContent === 'Ouvrir').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(w.document.getElementById('depositCreate').disabled, true);
  assert.match(w.document.getElementById('depositStatus').textContent, /non configurée/);
  dom.window.close();
});

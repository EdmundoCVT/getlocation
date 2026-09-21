const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeKv } = require('./helpers/fake-kv');
const { createClient } = require('../src/lib/clients');
const { createRental, updateRental, generateRentalContract } = require('../src/lib/rentals');
const { createManualContract, updateManualContract } = require('../src/lib/reservation-store');
const deposits = require('../src/lib/deposit-authorizations');
const { createDepositRequest } = require('../src/lib/deposits');
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(path.join(__dirname, '../migrations')).filter(x => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
  return { db, prepare(sql) { return { bind(...args) { const stmt = db.prepare(sql); return {
    async run() { return { success: true, meta: { changes: Number(stmt.run(...args).changes) } }; },
    async first() { return stmt.get(...args) || null; },
    async all() { return { results: stmt.all(...args) }; }
  }; } }; } };
}
function environment() { return { AGENCY_DB: database(), RESERVATIONS_KV: createFakeKv(), MOLLIE_DEPOSIT_API_KEY: 'live_FAKE_NEVER_REAL', MOLLIE_API_KEY: 'live_RENTAL_UNTOUCHED' }; }
const data = { vehiculeId: 'opel-corsa', dateDebut: '2027-10-01', heureDebut: '10:00', dateFin: '2027-10-05', heureFin: '10:00' };
async function rental(env) { const c = await createClient(env, { firstName: 'Test', lastName: 'Local' }, 'Agence'); return createRental(env, c.id, data, 'Agence'); }
async function mocked(fn) {
  const original = global.fetch;
  const calls = [];
  let state = 'open', captured = '0.00';
  global.fetch = async (url, init) => {
    calls.push({ url, ...init });
    assert.equal(init.headers.Authorization, 'Bearer live_FAKE_NEVER_REAL');
    const body = { id: 'tr_fake', mode: 'live', status: state, amountCaptured: { currency: 'EUR', value: captured }, captureBefore: '2027-10-07T10:00:00Z', _links: { checkout: { href: 'https://www.mollie.com/checkout/fake' } } };
    if (url.endsWith('/release-authorization') || init.method === 'DELETE') { state = 'canceled'; body.status = state; }
    if (url.endsWith('/captures')) return Response.json({ id: 'cpt_fake', status: 'pending' }, { status: 201 });
    return Response.json(body);
  };
  try { await fn({ calls, authorize() { state = 'authorized'; }, paid(amount) { state = 'paid'; captured = amount; } }); } finally { global.fetch = original; }
}
test('real SQLite: defaults and custom server snapshot, finalized amount immutable', async () => {
  const env = environment();
  const r = await rental(env);
  assert.equal(r.defaultDepositAmount, 650);
  const updated = await updateRental(env, r.id, { ...data, depositAmount: 512.34 }, 'Agence');
  assert.equal(updated.depositAmount, 512.34);
  assert.equal(updated.defaultDepositAmount, 650);
  await generateRentalContract(env, r.id, 'Agence');
  await assert.rejects(updateRental(env, r.id, { ...data, depositAmount: 10 }, 'Agence'), /finalis/);
});
test('real SQLite: simultaneous create has one winner; amount lock ends only after release', async () => {
  const env = environment(), r = await rental(env);
  await mocked(async ({ calls, authorize }) => {
    const results = await Promise.allSettled([1, 2].map(() => deposits.createDepositAuthorization(env, r.id, 'Agence', { origin: 'https://getlocation.fr' })));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(calls.filter(x => x.method === 'POST').length, 1);
    const a = results.find(x => x.status === 'fulfilled').value;
    assert.equal(JSON.parse(calls[0].body).amount.value, '650.00');
    assert.equal(JSON.parse(calls[0].body).captureMode, 'manual');
    assert.equal(JSON.parse(calls[0].body).testmode, undefined);
    await assert.rejects(updateRental(env, r.id, { ...data, depositAmount: 500 }, 'Agence'), /empreinte/);
    await assert.rejects(createDepositRequest(env, r.id, { amount: 650, method: 'especes' }, 'Agence'));
    authorize();
    await deposits.releaseDepositAuthorization(env, a.id, 'Agence');
    assert.ok(calls.some(x => x.url.endsWith('/release-authorization')));
    assert.equal((await updateRental(env, r.id, { ...data, depositAmount: 500 }, 'Agence')).depositAmount, 500);
    assert.equal(env.MOLLIE_API_KEY, 'live_RENTAL_UNTOUCHED');
  });
});
test('real SQLite: concurrent captures, pending is not success, partial paid is terminal', async () => {
  const env = environment(), r = await rental(env);
  await mocked(async ({ calls, authorize, paid }) => {
    const a = await deposits.createDepositAuthorization(env, r.id, 'Agence', { origin: 'https://getlocation.fr' });
    authorize(); await deposits.refreshDepositAuthorization(env, a.id, 'Agence');
    const results = await Promise.allSettled([1, 2].map(() => deposits.captureDepositAuthorization(env, a.id, 180, 'Agence')));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(calls.filter(x => x.url.endsWith('/captures')).length, 1);
    const pending = await deposits.getDepositAuthorizationById(env, a.id);
    assert.equal(pending.capturedAmountCents, 0);
    assert.equal(pending.captureRequested, true);
    await assert.rejects(deposits.captureDepositAuthorization(env, a.id, 200, 'Agence'), /déjà été demandée/);
    paid('180.00');
    const done = await deposits.refreshDepositAuthorization(env, a.id, 'Agence');
    assert.equal(done.status, 'capturee_partielle');
    assert.equal(done.capturedAmountCents, 18000);
    assert.equal(done.captureBefore, '2027-10-07T10:00:00Z');
    assert.equal(await deposits.getActiveDepositAuthorization(env, r.id), null);
  });
});
test('real SQLite: /contrat persists custom agency amount and ignores caller default; historical final unchanged', async () => {
  const env = environment();
  const raw = { vehiculeId: 'peugeot-3008', depositAmount: 812.34, defaultDepositAmount: 1, nom: 'Test', prenom: 'Local', depart: '2027-10-01T10:00', retour: '2027-10-05T10:00' };
  const c = await createManualContract(env, raw, 'Agence');
  assert.equal(c.defaultDepositAmount, 900);
  await mocked(async ({ calls }) => {
    await deposits.createDepositAuthorization(env, c.id, 'Agence', { origin: 'https://getlocation.fr', amount: 1 });
    assert.equal(JSON.parse(calls[0].body).amount.value, '812.34');
  });
  await assert.rejects(updateManualContract(env, c.id, { ...raw, depositAmount: 1 }, 'Agence'), /finalis/);
  const old = { id: 'res_historical', status: 'manual_contract', vehiculeId: 'opel-corsa' };
  await env.RESERVATIONS_KV.put(old.id, JSON.stringify(old));
  await assert.rejects(deposits.createDepositAuthorization(env, old.id, 'Agence', { origin: 'https://getlocation.fr' }), /historique absent/);
  assert.deepEqual(JSON.parse(await env.RESERVATIONS_KV.get(old.id)), old);
});
test('network ambiguity keeps create locked; no automatic second payment', async () => {
  const env = environment(), r = await rental(env), original = global.fetch;
  let count = 0;
  global.fetch = async () => { count++; throw new Error('timeout'); };
  try {
    await assert.rejects(deposits.createDepositAuthorization(env, r.id, 'Agence', { origin: 'https://getlocation.fr' }), /timeout/);
    await assert.rejects(deposits.createDepositAuthorization(env, r.id, 'Agence', { origin: 'https://getlocation.fr' }), /déjà en cours/);
    assert.equal(count, 1);
  } finally { global.fetch = original; }
});
test('capture versus release race sends at most one financial mutation', async () => {
  const env = environment(), r = await rental(env);
  await mocked(async ({ calls, authorize }) => {
    const a = await deposits.createDepositAuthorization(env, r.id, 'Agence', { origin: 'https://getlocation.fr' });
    authorize(); await deposits.refreshDepositAuthorization(env, a.id, 'Agence');
    const results = await Promise.allSettled([deposits.captureDepositAuthorization(env, a.id, 180, 'Agence'), deposits.releaseDepositAuthorization(env, a.id, 'Agence')]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(calls.filter(x => /\/(captures|release-authorization)$/.test(x.url)).length, 1);
  });
});
test('mode mismatch and expired authorization block capture without financial request', async () => {
  const env = environment(), r = await rental(env);
  await mocked(async ({ calls, authorize }) => {
    const a = await deposits.createDepositAuthorization(env, r.id, 'Agence', { origin: 'https://getlocation.fr' });
    authorize(); await deposits.refreshDepositAuthorization(env, a.id, 'Agence');
    env.MOLLIE_DEPOSIT_API_KEY = 'test_FAKE';
    await assert.rejects(deposits.captureDepositAuthorization(env, a.id, 180, 'Agence'), /mode/);
    env.MOLLIE_DEPOSIT_API_KEY = 'live_FAKE_NEVER_REAL';
    await deposits.syncDepositAuthorizationFromWebhook(env, { id: 'tr_fake', mode: 'live', status: 'authorized', captureBefore: '2000-01-01T00:00:00Z' });
    await assert.rejects(deposits.captureDepositAuthorization(env, a.id, 180, 'Agence'), /expir/);
    assert.equal(calls.filter(x => x.url.endsWith('/captures')).length, 0);
  });
});
test('agency-only endpoint rejects POST without CSRF; malformed monetary input rejected', async () => {
  const { makeAgencyEnv, loginAgency, agencyRequest } = require('./helpers/agency-session');
  const { handleAgencyDepositAuthorizations } = require('../src/api/agency-deposit-authorizations');
  const env = makeAgencyEnv(), session = await loginAgency(env);
  const request = agencyRequest('https://getlocation.fr/api/agency-deposit-authorizations', { method: 'POST', session, body: { action: 'create', rentalId: 'res_fake' } });
  request.headers.delete('x-agency-csrf');
  assert.equal((await handleAgencyDepositAuthorizations(request, env)).status, 403);
  const { depositTerms } = require('../src/lib/deposit-terms');
  for (const amount of [0, -1, 1.001, true, '', null, 'NaN', 1e20]) assert.throws(() => depositTerms({ vehiculeId: 'opel-corsa', depositAmount: amount }), /invalide/);
});
test('migration 0007 preserves existing authorizations and historical NULL amounts', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync('migrations').filter(f => f.endsWith('.sql') && f < '0007').sort()) db.exec(fs.readFileSync('migrations/' + file, 'utf8'));
  db.exec("INSERT INTO clients(id, first_name,last_name,created_at,updated_at,created_by,updated_by) VALUES ('c','Test','Local','date','date','a','a')");
  db.exec("INSERT INTO rentals(id,client_id,vehicule_id,date_debut,heure_debut,date_fin,heure_fin,status,created_at,updated_at,created_by,updated_by) VALUES ('r','c','opel-corsa','2026-10-01','10:00','2026-10-05','10:00','contrat_genere','date','date','a','a')");
  db.exec("INSERT INTO deposit_authorizations(id,rental_id,mollie_payment_id,authorized_amount_cents,status,mollie_status,created_at,updated_at,created_by,updated_by) VALUES ('d','r','tr_old',60000,'autorisee','authorized','date','date','a','a')");
  const before = db.prepare('SELECT * FROM deposit_authorizations').get();
  db.exec(fs.readFileSync('migrations/0007_deposit_contracts.sql', 'utf8'));
  const after = db.prepare('SELECT * FROM deposit_authorizations').get();
  for (const key of Object.keys(before)) assert.equal(after[key], before[key]);
  assert.equal(db.prepare('SELECT deposit_amount_cents FROM rentals').get().deposit_amount_cents, null);
  assert.equal(db.prepare('SELECT deposit_amount_cents FROM deposit_subjects').get().deposit_amount_cents, null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

// End-to-end: one host + 4 players play a full 10-question team round over real sockets.
// Run: node test/e2e.js  (server must be running on PORT or 3000)
const { io } = require('socket.io-client');
const assert = require('assert');
const { scoreGuess, average } = require('../lib/scoring');

const URL = `http://localhost:${process.env.PORT || 3000}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = () => new Promise((res) => { const s = io(URL, { transports: ['websocket'] }); s.on('connect', () => res(s)); });
const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const nextState = (s, pred) => new Promise((res) => { const h = (st) => { if (pred(st)) { s.off('state', h); res(st); } }; s.on('state', h); });

(async () => {
  const host = await connect();
  let hostState;
  host.on('state', (s) => (hostState = s));
  const { code, hostToken } = await emit(host, 'host:create', {});
  assert.match(code, /^[A-Z]{4}$/);

  host.emit('host:settings', { mode: 'team', teamCount: 2, timer: 90 });
  await wait(100);

  const names = ['براك', 'لولوة', 'أحمد', 'سارة'];
  const players = [];
  for (const n of names) {
    const s = await connect();
    let st; s.on('state', (x) => (st = x));
    const r = await emit(s, 'player:join', { code, name: n });
    assert.ok(r.ok, 'join ok');
    players.push({ s, id: r.playerId, name: n, get st() { return st; } });
  }
  // Duplicate name gets a suffix
  const dup = await connect();
  const rd = await emit(dup, 'player:join', { code, name: 'براك' });
  await wait(100);
  assert.ok(hostState.players.some((p) => p.name === 'براك 2'), 'duplicate name suffixed');
  dup.emit('player:leave');
  await wait(100);

  // Teams: first two pick t1, third picks t2, fourth picks nothing (auto-assigned on start)
  players[0].s.emit('player:team', { teamId: 't1' });
  players[1].s.emit('player:team', { teamId: 't1' });
  players[2].s.emit('player:team', { teamId: 't2' });
  await wait(100);

  host.emit('host:start');
  await nextState(host, (s) => s.phase === 'ready');
  assert.ok(hostState.players.every((p) => p.teamId), 'everyone assigned to a team');
  assert.equal(hostState.players.find((p) => p.name === 'سارة').teamId, 't2', 'auto-assign to smallest team');

  // Host resume with token (simulates refresh)
  const host2 = await connect();
  const resumed = await emit(host2, 'host:resume', { code, hostToken });
  assert.ok(resumed.ok, 'host resume works');
  const bad = await emit(host2, 'host:resume', { code, hostToken: 'nope' });
  assert.ok(!bad.ok, 'bad token rejected');

  const expected = new Map(players.map((p) => [p.id, []]));
  const teamExpected = { t1: [], t2: [] };
  const factors = [1, 2, 0.5, 10]; // player i guesses answer * factor (player 3 skips Q3)

  for (let q = 0; q < 10; q++) {
    host.emit('host:go');
    const qs = await nextState(host, (s) => s.phase === 'question' && s.qIndex === q);
    assert.ok(qs.question.text && qs.question.answer == null, 'answer hidden during question');
    await wait(60);
    assert.equal(players[0].st.phase, 'question');
    assert.equal(players[0].st.question.answer, undefined, 'answer hidden from phones');

    // We need the answer to build guesses: read it from the file by question id
    const bank = require('../data/questions.json');
    const ans = bank.find((x) => x.id === qs.question.id).answer;

    const revealP = nextState(host, (s) => s.phase === 'reveal');
    for (let i = 0; i < players.length; i++) {
      if (i === 3 && q === 2) continue; // skip -> penalty
      const r = await emit(players[i].s, 'player:guess', { value: ans * factors[i] });
      assert.ok(r.ok);
    }
    let rs;
    if (q === 2) { host.emit('host:reveal'); rs = await revealP; } else rs = await revealP; // early reveal when all answered

    // Compute expected
    const ms = players.map((p, i) => (i === 3 && q === 2 ? null : scoreGuess(ans * factors[i], ans)));
    const penalty = Math.max(100, ...ms.filter((m) => m != null));
    const final = ms.map((m) => (m == null ? penalty : m));
    players.forEach((p, i) => expected.get(p.id).push(final[i]));
    teamExpected.t1.push(average([final[0], final[1]]));
    teamExpected.t2.push(average([final[2], final[3]]));

    for (const r of rs.reveal.results) {
      const i = players.findIndex((p) => p.id === r.id);
      assert.ok(Math.abs(r.multiple - final[i]) < 1e-9, `multiple Q${q} ${r.name}`);
    }
    assert.ok(Math.abs(rs.reveal.teamScores.t1 - teamExpected.t1[q]) < 1e-9, 'team t1 score');
    if (q === 2) assert.ok(rs.reveal.results.find((r) => r.id === players[3].id).missed, 'skip marked missed');

    host.emit('host:next');
    await nextState(host, (s) => s.phase === (q === 9 ? 'final' : 'leaderboard'));
    if (q < 9) { host.emit('host:next'); await nextState(host, (s) => s.phase === 'ready'); }
  }

  const st = hostState.standings;
  for (const s of st.solo) assert.ok(Math.abs(s.avg - average(expected.get(s.id))) < 1e-9, `avg ${s.name}`);
  assert.deepEqual(st.solo.map((s) => s.name), ['براك', 'لولوة', 'أحمد', 'سارة'], 'ranking order');
  assert.equal(st.teams[0].id, 't1', 'team t1 wins');
  console.log('Final solo:', st.solo.map((s) => `${s.name} ×${s.avg.toFixed(2)}`).join(' | '));
  console.log('Final teams:', st.teams.map((t) => `${t.name} ×${t.avg.toFixed(2)}`).join(' | '));

  // Unit checks on scoring
  assert.equal(scoreGuess(500, 1000), 2);
  assert.equal(scoreGuess(10000, 1000), 10);
  assert.equal(scoreGuess(1000, 1000), 1);

  // New round from final keeps players, avoids repeat questions
  host.emit('host:lobby');
  await nextState(host, (s) => s.phase === 'lobby');
  assert.equal(hostState.players.length, 4);

  console.log('ALL E2E CHECKS PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });

// Tiny check helpers shared by the test files. A failed check is printed and makes the
// process exit with code 1, which is what `node --test` and GitHub Actions look at.
let fails = 0;
let passes = 0;
export function ok(cond, msg) {
  if (cond) { passes++; console.log('ok', msg); } else { fails++; console.log('FAIL', msg); }
}
export function finish() {
  console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nALL PASSED (${passes})`);
  process.exitCode = fails ? 1 : 0;
}
export function client(base) {
  return {
    async post(path, body, token, ip) {
      const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(ip ? { 'x-test-ip': ip } : {}) }, body: JSON.stringify(body) });
      return { status: r.status, ...(await r.json()) };
    },
    sql: async (q) => (await fetch(base + '/__sql', { method: 'POST', body: q })).json(),
    mails: async () => (await fetch(base + '/__mail')).json()
  };
}

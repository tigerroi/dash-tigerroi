import assert from "node:assert/strict";
import test from "node:test";
import { syncFillRate } from "./sync-fill-rate.mjs";

function fakeStore(nodes = {}) {
  const writes = [];
  return {
    writes,
    read: async (path) => nodes[path] ?? null,
    readFrom: async (path) => nodes[path] ?? null,
    update: async (path, value) => writes.push(["update", path, value]),
    replace: async (path, value) => writes.push(["replace", path, value]),
  };
}

const NOW = new Date("2026-09-24T06:05:00Z"); // 13:05 WIB
const gamAccounts = {
  a: { name: "x.com", networkCode: "1", googleCredential: "cred" },
  b: { name: "y.com", networkCode: "2", googleCredential: "cred" },
  gone: { name: "z.com", networkCode: "3", deletedAt: "2026-01-01" },
};
const tokenOf = async () => "token";

test("menulis daun berubah, status, dan cabang isu kosong", async () => {
  const store = fakeStore({ gamAccounts, googleApiConfigs: {} });
  const fetchHourly = async (account) =>
    account.networkCode === "1"
      ? [{ date: "2026-09-24", hour: "11", site: "a.x.com", req: 10, imp: 4 }]
      : [{ date: "2026-09-24", hour: "10", site: "b.y.com", req: 5, imp: 5 }];

  const res = await syncFillRate(store, { now: NOW, fetchHourly, tokenOf });

  assert.deepEqual(res, { networks: 2, failed: 0, written: 2 });
  const [update] = store.writes.filter(([kind, path]) => kind === "update" && path === "dashboard/fillRate");
  assert.deepEqual(update[2], {
    "2026-09-24/a,x,com/h11": { req: 10, imp: 4, partial: true },
    "2026-09-24/b,y,com/h10": { req: 5, imp: 5, partial: true },
  });
  const status = store.writes.find(([, path]) => path === "dashboard/fillRateStatus")[2];
  assert.equal(status.lastRunAt, "2026-09-24 13:05");
  assert.deepEqual(status.networks.n1, { name: "x.com", ok: true, lastSlot: "2026-09-24T11" });
  const issues = store.writes.find(([, path]) => path === "dashboard/syncIssues/fillRate")[2];
  assert.equal(issues.count, 0);
});

test("satu network gagal: yang lain tetap ditulis, isu tercatat, data lama tidak disentuh", async () => {
  const store = fakeStore({
    gamAccounts,
    googleApiConfigs: {},
    "dashboard/fillRate": { "2026-09-24": { "b,y,com": { h09: { req: 1, imp: 1 } } } },
  });
  const fetchHourly = async (account) => {
    if (account.networkCode === "2") throw new Error("GAM POST ... -> 403: denied");
    return [{ date: "2026-09-24", hour: "11", site: "a.x.com", req: 10, imp: 4 }];
  };

  const res = await syncFillRate(store, { now: NOW, fetchHourly, tokenOf });

  assert.equal(res.failed, 1);
  const update = store.writes.find(([kind]) => kind === "update")[2];
  assert.deepEqual(Object.keys(update), ["2026-09-24/a,x,com/h11"]);
  const issues = store.writes.find(([, path]) => path === "dashboard/syncIssues/fillRate")[2];
  assert.equal(issues.count, 1);
  assert.equal(issues.items.i0.target, "y.com");
  const status = store.writes.find(([, path]) => path === "dashboard/fillRateStatus")[2];
  assert.equal(status.networks.n2.ok, false);
});

test("tanpa perubahan: tidak ada update ke dashboard/fillRate", async () => {
  const store = fakeStore({
    gamAccounts: { a: gamAccounts.a },
    googleApiConfigs: {},
    "dashboard/fillRate": {
      "2026-09-24": { "a,x,com": { h11: { req: 10, imp: 4, partial: true } } },
    },
  });
  const fetchHourly = async () => [{ date: "2026-09-24", hour: "11", site: "a.x.com", req: 10, imp: 4 }];

  const res = await syncFillRate(store, { now: NOW, fetchHourly, tokenOf });

  assert.equal(res.written, 0);
  assert.equal(store.writes.filter(([kind]) => kind === "update").length, 0);
});

test("token yang gagal menjatuhkan akun berkredensial itu saja", async () => {
  const accountsWithDiffCreds = {
    a: { name: "x.com", networkCode: "1", googleCredential: "cred-a" },
    b: { name: "y.com", networkCode: "2", googleCredential: "cred-b" },
  };
  const store = fakeStore({ gamAccounts: accountsWithDiffCreds, googleApiConfigs: {} });
  const res = await syncFillRate(store, {
    now: NOW,
    fetchHourly: async () => [],
    tokenOf: async (account) => {
      if (account.googleCredential === "cred-a") throw new Error("invalid_grant");
      return "t";
    },
  });
  assert.equal(res.failed, 1);
});

test("dua akun kredensial sama: tokenOf dipanggil sekali saja", async () => {
  let tokenOfCalls = 0;
  const accountsSharedCred = {
    a: { name: "x.com", networkCode: "1", googleCredential: "cred-shared" },
    b: { name: "y.com", networkCode: "2", googleCredential: "cred-shared" },
  };
  const store = fakeStore({ gamAccounts: accountsSharedCred, googleApiConfigs: {} });
  const res = await syncFillRate(store, {
    now: NOW,
    fetchHourly: async () => [],
    tokenOf: async () => {
      tokenOfCalls++;
      return "token";
    },
  });
  assert.equal(tokenOfCalls, 1, "tokenOf hanya dipanggil sekali untuk kredensial yang sama");
  assert.equal(res.failed, 0);
  assert.equal(res.networks, 2);
});

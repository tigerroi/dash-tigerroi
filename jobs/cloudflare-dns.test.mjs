import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveZoneId,
  getZoneDnsRecords,
  syncSubdomainRecord,
} from "./cloudflare-dns.js";

// Mock fetch global untuk menguji integrasi Cloudflare API v4
test("resolveZoneId menemukan zoneId dari nama zona", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes("/zones")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            success: true,
            result: [
              { id: "zone_123", name: "ihopmenuwithprices.us" },
              { id: "zone_456", name: "tacobellmenuu.us" },
            ],
            result_info: { total_pages: 1 },
          }),
      };
    }
    return { ok: false, text: async () => "{}" };
  };

  try {
    const zoneId = await resolveZoneId("dummy_token", "ihopmenuwithprices.us");
    assert.equal(zoneId, "zone_123");
  } finally {
    global.fetch = originalFetch;
  }
});

test("syncSubdomainRecord membuat record baru jika belum ada", async () => {
  const originalFetch = global.fetch;
  let createdPayload = null;

  global.fetch = async (url, options) => {
    if (url.includes("/zones") && !url.includes("dns_records")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            success: true,
            result: [{ id: "zone_123", name: "ihopmenuwithprices.us" }],
            result_info: { total_pages: 1 },
          }),
      };
    }

    if (url.includes("/dns_records") && options?.method === "POST") {
      createdPayload = JSON.parse(options.body);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            success: true,
            result: {
              id: "rec_new",
              name: "menu.ihopmenuwithprices.us",
              type: createdPayload.type,
              content: createdPayload.content,
              proxied: createdPayload.proxied,
              ttl: 1,
            },
          }),
      };
    }

    if (url.includes("/dns_records")) {
      // Return daftar kosong
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            success: true,
            result: [],
            result_info: { total_pages: 1 },
          }),
      };
    }

    return { ok: false, text: async () => "{}" };
  };

  try {
    const result = await syncSubdomainRecord({
      apiKey: "dummy_token",
      zoneName: "ihopmenuwithprices.us",
      subdomain: "menu",
      content: "195.201.56.95",
      type: "A",
      proxied: true,
    });

    assert.equal(result.action, "created");
    assert.equal(result.record.id, "rec_new");
    assert.equal(createdPayload.content, "195.201.56.95");
    assert.equal(createdPayload.proxied, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("syncSubdomainRecord idempotently mengembalikan unchanged jika record sudah persis sama", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url.includes("/zones") && !url.includes("dns_records")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            success: true,
            result: [{ id: "zone_123", name: "ihopmenuwithprices.us" }],
            result_info: { total_pages: 1 },
          }),
      };
    }

    if (url.includes("/dns_records")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            success: true,
            result: [
              {
                id: "rec_existing",
                name: "menu.ihopmenuwithprices.us",
                type: "A",
                content: "195.201.56.95",
                proxied: true,
                ttl: 1,
              },
            ],
            result_info: { total_pages: 1 },
          }),
      };
    }

    return { ok: false, text: async () => "{}" };
  };

  try {
    const result = await syncSubdomainRecord({
      apiKey: "dummy_token",
      zoneName: "ihopmenuwithprices.us",
      subdomain: "menu",
      content: "195.201.56.95",
      type: "A",
      proxied: true,
    });

    assert.equal(result.action, "unchanged");
    assert.equal(result.record.id, "rec_existing");
  } finally {
    global.fetch = originalFetch;
  }
});

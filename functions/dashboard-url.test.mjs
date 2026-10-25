import assert from "node:assert/strict";
import test from "node:test";
import { dashboardUrl } from "./dashboard-url.js";

test("domain dashboard per project, DASHBOARD_URL menang, tanpa project kosong", () => {
  assert.equal(dashboardUrl({ GCLOUD_PROJECT: "dashboard-tigerroi" }), "https://dashboard-tigerroi.web.app");
  assert.equal(dashboardUrl({ FIREBASE_PROJECT_ID: "my-custom-project" }), "https://my-custom-project.web.app");
  assert.equal(dashboardUrl({ GCLOUD_PROJECT: "lain" }), "https://lain.web.app");
  assert.equal(
    dashboardUrl({ GCLOUD_PROJECT: "dashboard-tigerroi", DASHBOARD_URL: "https://x.test/" }),
    "https://x.test",
  );
  assert.equal(dashboardUrl({}), "");
});

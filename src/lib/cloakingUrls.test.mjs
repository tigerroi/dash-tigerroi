import assert from "node:assert/strict";
import test from "node:test";
import { parseCloakingUrls } from "./cloakingUrls.js";

test("parseCloakingUrls membuang kembar, yang sudah ada, dan menolak yang bukan URL", () => {
  const { fresh, invalid } = parseCloakingUrls(
    " https://a.test/1 \nhttps://a.test/1\n\nhttps://a.test/2\nbukan url\nftp://x.test",
    [{ url: "https://a.test/2" }],
  );
  assert.deepEqual(fresh, ["https://a.test/1"]);
  assert.deepEqual(invalid, ["bukan url", "ftp://x.test"]);
});

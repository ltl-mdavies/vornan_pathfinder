import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiftProofOrderReadUrl,
  buildLiftProofReportReadUrl,
  LIFT_PROOF_WRITE_CAPABILITY,
  readLiftProofOrder,
  type LiftProofFetch
} from "../src/index.ts";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("builds the documented p0 and p1/p2 Lift read queries", () => {
  const orderUrl = new URL(buildLiftProofOrderReadUrl("https://admin.example/AS360Orders?offset=0", "a0221132"));
  const proofUrl = new URL(
    buildLiftProofReportReadUrl("https://admin.example/AS360ProofReport?offset=0", "A0221132", "9301338")
  );

  assert.equal(orderUrl.searchParams.get("p0"), "A0221132");
  assert.equal(proofUrl.searchParams.get("p1"), "A0221132");
  assert.equal(proofUrl.searchParams.get("p2"), "9301338");
  assert.equal(LIFT_PROOF_WRITE_CAPABILITY, "not_implemented");
});

test("performs line-scoped report reads with bounded concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const fetcher: LiftProofFetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("orders")) {
      return jsonResponse({ rowset: Array.from({ length: 8 }, (_, index) => ({ ORDER_LINE_ID: index + 1 })) });
    }
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return jsonResponse({ rowset: [{ ORDER_LINE_ID: url.searchParams.get("p2"), ATTACHMENT_ID: `a-${url.searchParams.get("p2")}` }] });
  };

  const snapshot = await readLiftProofOrder("A0221132", {
    fetcher,
    config: {
      order_read_url: "https://admin.example/orders",
      proof_report_read_url: "https://admin.example/proofs",
      concurrency: 3
    }
  });

  assert.equal(snapshot.diagnostics.line_reads.length, 8);
  assert.equal(maximumActive, 3);
  assert.equal(snapshot.diagnostics.fallback_read.attempted, false);
});

test("uses one order-scoped fallback only when line reads fail without usable rows", async () => {
  const requested: string[] = [];
  const fetcher: LiftProofFetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    if (url.pathname.includes("orders")) {
      return jsonResponse({ rowset: [{ ORDER_LINE_ID: 10 }, { ORDER_LINE_ID: 20 }] });
    }
    if (!url.searchParams.has("p2")) {
      return jsonResponse({ rowset: [{ ORDER_LINE_ID: 10, ATTACHMENT_ID: 100 }] });
    }
    return url.searchParams.get("p2") === "10" ? jsonResponse({ error: "unavailable" }, 503) : jsonResponse({ rowset: [] });
  };

  const snapshot = await readLiftProofOrder("A0221132", {
    fetcher,
    config: {
      order_read_url: "https://admin.example/orders",
      proof_report_read_url: "https://admin.example/proofs"
    }
  });

  assert.equal(snapshot.diagnostics.fallback_read.attempted, true);
  assert.equal(snapshot.diagnostics.fallback_read.row_count, 1);
  assert.equal(requested.filter((url) => !new URL(url).searchParams.has("p2") && url.includes("proofs")).length, 1);
});

test("does not fall back when any line read returned usable proof rows", async () => {
  const fetcher: LiftProofFetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("orders")) {
      return jsonResponse({ rowset: [{ ORDER_LINE_ID: 10 }, { ORDER_LINE_ID: 20 }] });
    }
    return url.searchParams.get("p2") === "10"
      ? jsonResponse({ error: "unavailable" }, 503)
      : jsonResponse({ rowset: [{ ORDER_LINE_ID: 20, ATTACHMENT_ID: 200 }] });
  };

  const snapshot = await readLiftProofOrder("A0221132", {
    fetcher,
    config: {
      order_read_url: "https://admin.example/orders",
      proof_report_read_url: "https://admin.example/proofs"
    }
  });

  assert.equal(snapshot.diagnostics.fallback_read.attempted, false);
  assert.equal(snapshot.proof_payloads.length, 1);
});

test("does not read proof reports for cancelled or caller-ineligible order lines", async () => {
  const lineIds: string[] = [];
  const fetcher: LiftProofFetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("orders")) {
      return jsonResponse({
        rowset: [
          { ORDER_LINE_ID: 10, LINE_STATUS: "CANCELLED", LINE_STEP_NUMBER: 4 },
          { ORDER_LINE_ID: 20, LINE_STATUS: "ACTIVE", LINE_STEP_NUMBER: 2 },
          { ORDER_LINE_ID: 30, LINE_STATUS: "ACTIVE", LINE_STEP_NUMBER: 4 }
        ]
      });
    }
    lineIds.push(url.searchParams.get("p2") ?? "");
    return jsonResponse({ rowset: [] });
  };

  await readLiftProofOrder("A0221132", {
    fetcher,
    config: {
      order_read_url: "https://admin.example/orders",
      proof_report_read_url: "https://admin.example/proofs"
    },
    isProofReadableOrderRow: (row) => Number(row.LINE_STEP_NUMBER) >= 3
  });

  assert.deepEqual(lineIds, ["30"]);
});

test("validates the order header before any proof-report read", async () => {
  const requested: string[] = [];
  const fetcher: LiftProofFetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.pathname);
    return jsonResponse({ rowset: [{ CUSTOMER_ID: 9999, ORDER_LINE_ID: 10 }] });
  };

  await assert.rejects(
    () => readLiftProofOrder("A0221132", {
      fetcher,
      config: {
        order_read_url: "https://admin.example/orders",
        proof_report_read_url: "https://admin.example/proofs"
      },
      validateOrderPayload: () => {
        throw new Error("outside cohort");
      }
    }),
    /outside cohort/
  );
  assert.deepEqual(requested, ["/orders"]);
});

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { calculateMetrics, runDetection, type RuleId } from "./button-detector";

const groundTruthUrl = pathToFileURL(`${process.cwd()}/test-sites/button-ground-truth.html`).toString();

function rulesForButton(resultRules: RuleId[]): string[] {
  return [...new Set(resultRules)].sort();
}

async function main() {
  const result = await runDetection(groundTruthUrl);

  assert.equal(result.summary.totalButtons, 7, "ground truth page should expose seven visible buttons");

  const bySelector = new Map(result.results.map((entry) => [entry.button.selector, entry]));

  for (const entry of result.results) {
    assert.ok(entry.button.expected, `${entry.button.selector} must define expected result`);

    if (entry.button.expected === "PASS") {
      assert.equal(entry.status, "PASS", `${entry.button.selector} should not be reported as BUG`);
      continue;
    }

    assert.equal(entry.status, "BUG", `${entry.button.selector} should be reported as BUG`);
    assert.deepEqual(
      rulesForButton(entry.bugs.map((bug) => bug.rule)),
      rulesForButton(entry.button.expectedRules),
      `${entry.button.selector} should report the expected rules`,
    );
  }

  assert.equal(bySelector.get("#normal-pass")?.status, "PASS");
  assert.equal(bySelector.get("#long-fit-pass")?.status, "PASS");
  assert.equal(bySelector.get("#wrapped-pass")?.status, "PASS");
  assert.equal(bySelector.get("#disabled-pass")?.status, "PASS");
  assert.equal(bySelector.get("#horizontal-overflow-bug")?.status, "BUG");
  assert.equal(bySelector.get("#clipped-text-bug")?.status, "BUG");
  assert.equal(bySelector.get("#fixed-dimensions-bug")?.status, "BUG");

  const metrics = calculateMetrics(result.results);
  assert.deepEqual(metrics, {
    truePositives: 3,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 1,
    recall: 1,
  });

  console.log(JSON.stringify({ status: "PASS", metrics, summary: result.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

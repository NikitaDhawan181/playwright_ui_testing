import { calculateMetrics, runDetection } from "./button-detector";

function parseUrl(argv: string[]): string {
  const urlFlagIndex = argv.indexOf("--url");
  const url = urlFlagIndex >= 0 ? argv[urlFlagIndex + 1] : undefined;

  if (!url) {
    throw new Error("Usage: npm run test-ui -- --url <URL>");
  }

  return url;
}

async function main() {
  const url = parseUrl(process.argv.slice(2));
  const result = await runDetection(url);
  const hasGroundTruth = result.results.some((entry) => entry.button.expected);

  const output = {
    ...result,
    metrics: hasGroundTruth ? calculateMetrics(result.results) : undefined,
  };

  console.log(JSON.stringify(output, null, 2));

  if (result.summary.bug > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

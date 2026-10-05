import { chromium, type Browser, type Page } from "playwright";

export type RuleId = "button-text-overflow" | "button-text-clipping";

export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ButtonMeasurement = {
  index: number;
  text: string;
  accessibleName: string;
  tag: string;
  role: string;
  selector: string;
  expected?: "PASS" | "BUG";
  expectedRules: RuleId[];
  visible: boolean;
  enabled: boolean;
  boundingBox: Box;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  contentBox: {
    usableWidth: number;
    usableHeight: number;
    textWidth: number;
    textHeight: number;
    textBox: Box;
  };
  css: {
    display: string;
    boxSizing: string;
    overflowX: string;
    overflowY: string;
    textOverflow: string;
    whiteSpace: string;
    wordBreak: string;
    lineHeight: string;
    font: string;
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
    paddingBottom: number;
    borderLeftWidth: number;
    borderRightWidth: number;
    borderTopWidth: number;
    borderBottomWidth: number;
  };
  parent: {
    tag: string;
    selector: string;
    boundingBox: Box | null;
    clientWidth: number | null;
    clientHeight: number | null;
    scrollWidth: number | null;
    scrollHeight: number | null;
  };
};

export type BugReport = {
  button: {
    index: number;
    text: string;
    accessibleName: string;
    selector: string;
    tag: string;
    role: string;
  };
  rule: RuleId;
  actualMeasurements: Pick<
    ButtonMeasurement,
    | "boundingBox"
    | "clientWidth"
    | "clientHeight"
    | "scrollWidth"
    | "scrollHeight"
    | "contentBox"
    | "css"
    | "parent"
  >;
  reason: string;
};

export type ButtonResult = {
  status: "PASS" | "BUG";
  button: ButtonMeasurement;
  bugs: BugReport[];
};

export type DetectionResult = {
  url: string;
  title: string;
  summary: {
    totalButtons: number;
    pass: number;
    bug: number;
  };
  results: ButtonResult[];
};

export type Metrics = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
};

const TOLERANCE_PX = 2;
const HIDDEN_OVERFLOW_VALUES = new Set(["hidden", "clip"]);

export async function runDetection(url: string): Promise<DetectionResult> {
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    return await detectButtonsOnPage(page, url);
  } finally {
    await browser?.close();
  }
}

export async function detectButtonsOnPage(page: Page, url: string): Promise<DetectionResult> {
  const buttons = await collectButtonMeasurements(page);
  const results = buttons.map((button) => classifyButton(button));
  const bug = results.filter((result) => result.status === "BUG").length;

  return {
    url,
    title: await page.title(),
    summary: {
      totalButtons: results.length,
      pass: results.length - bug,
      bug,
    },
    results,
  };
}

export async function collectButtonMeasurements(page: Page): Promise<ButtonMeasurement[]> {
  return page.evaluate(() => {
    type LocalBox = {
      x: number;
      y: number;
      width: number;
      height: number;
    };

    const round = (value: number) => Math.round(value * 100) / 100;

    const toBox = (rect: DOMRect): LocalBox => ({
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
    });

    const numberStyle = (value: string): number => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const textOf = (element: Element): string => {
      if (element instanceof HTMLInputElement) {
        return element.value.trim();
      }

      return ((element as HTMLElement).innerText || element.textContent || "").trim().replace(/\s+/g, " ");
    };

    const accessibleNameOf = (element: Element): string => {
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel) {
        return ariaLabel;
      }

      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const label = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() || "")
          .filter(Boolean)
          .join(" ")
          .trim();
        if (label) {
          return label;
        }
      }

      if (element instanceof HTMLInputElement) {
        return element.value.trim() || element.title.trim();
      }

      return textOf(element) || element.getAttribute("title")?.trim() || "";
    };

    const implicitRoleOf = (element: Element): string => {
      const explicit = element.getAttribute("role")?.trim();
      if (explicit) {
        return explicit;
      }

      const tag = element.tagName.toLowerCase();
      if (tag === "button") {
        return "button";
      }

      if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) {
        return "button";
      }

      return "";
    };

    const cssEscape = (value: string): string => {
      const nativeEscape = (window.CSS as typeof CSS | undefined)?.escape;
      if (nativeEscape) {
        return nativeEscape(value);
      }

      return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    };

    const selectorOf = (element: Element): string => {
      const testId = element.getAttribute("data-testid");
      if (testId) {
        return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      }

      if (element.id) {
        return `#${cssEscape(element.id)}`;
      }

      const parts: string[] = [];
      let current: Element | null = element;

      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }

        const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current?.tagName);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
        current = parent;
      }

      return `body > ${parts.join(" > ")}`;
    };

    const textBoxOf = (element: Element): LocalBox => {
      if (element instanceof HTMLInputElement) {
        return toBox(element.getBoundingClientRect());
      }

      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      range.detach();

      if (rects.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }

      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));

      return {
        x: round(left),
        y: round(top),
        width: round(right - left),
        height: round(bottom - top),
      };
    };

    const candidateSelector = 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]';
    const candidates = Array.from(document.querySelectorAll(candidateSelector)).filter(isVisible);

    return candidates.map((element, index) => {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      const textBox = textBoxOf(element);
      const parent = htmlElement.parentElement;
      const parentRect = parent?.getBoundingClientRect();

      const paddingLeft = numberStyle(style.paddingLeft);
      const paddingRight = numberStyle(style.paddingRight);
      const paddingTop = numberStyle(style.paddingTop);
      const paddingBottom = numberStyle(style.paddingBottom);

      return {
        index,
        text: textOf(element),
        accessibleName: accessibleNameOf(element),
        tag: element.tagName.toLowerCase(),
        role: implicitRoleOf(element),
        selector: selectorOf(element),
        expected: htmlElement.dataset.expected as "PASS" | "BUG" | undefined,
        expectedRules: (htmlElement.dataset.expectedRules || "")
          .split(",")
          .map((rule) => rule.trim())
          .filter(Boolean),
        visible: true,
        enabled:
          !(htmlElement as HTMLButtonElement).disabled &&
          htmlElement.getAttribute("aria-disabled") !== "true" &&
          !htmlElement.matches("[disabled]"),
        boundingBox: toBox(rect),
        clientWidth: htmlElement.clientWidth,
        clientHeight: htmlElement.clientHeight,
        scrollWidth: htmlElement.scrollWidth,
        scrollHeight: htmlElement.scrollHeight,
        contentBox: {
          usableWidth: round(htmlElement.clientWidth - paddingLeft - paddingRight),
          usableHeight: round(htmlElement.clientHeight - paddingTop - paddingBottom),
          textWidth: textBox.width,
          textHeight: textBox.height,
          textBox,
        },
        css: {
          display: style.display,
          boxSizing: style.boxSizing,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
          wordBreak: style.wordBreak,
          lineHeight: style.lineHeight,
          font: style.font,
          paddingLeft,
          paddingRight,
          paddingTop,
          paddingBottom,
          borderLeftWidth: numberStyle(style.borderLeftWidth),
          borderRightWidth: numberStyle(style.borderRightWidth),
          borderTopWidth: numberStyle(style.borderTopWidth),
          borderBottomWidth: numberStyle(style.borderBottomWidth),
        },
        parent: {
          tag: parent?.tagName.toLowerCase() || "",
          selector: parent ? selectorOf(parent) : "",
          boundingBox: parentRect ? toBox(parentRect) : null,
          clientWidth: parent ? parent.clientWidth : null,
          clientHeight: parent ? parent.clientHeight : null,
          scrollWidth: parent ? parent.scrollWidth : null,
          scrollHeight: parent ? parent.scrollHeight : null,
        },
      };
    }) as ButtonMeasurement[];
  });
}

export function classifyButton(button: ButtonMeasurement): ButtonResult {
  const bugs: BugReport[] = [];
  const horizontalOverflow = button.scrollWidth > button.clientWidth + TOLERANCE_PX;
  const verticalOverflow = button.scrollHeight > button.clientHeight + TOLERANCE_PX;
  const textBeyondUsableWidth = button.contentBox.textWidth > button.contentBox.usableWidth + TOLERANCE_PX;
  const textBeyondUsableHeight = button.contentBox.textHeight > button.contentBox.usableHeight + TOLERANCE_PX;
  const clipsHorizontal = HIDDEN_OVERFLOW_VALUES.has(button.css.overflowX);
  const clipsVertical = HIDDEN_OVERFLOW_VALUES.has(button.css.overflowY);

  if (horizontalOverflow || verticalOverflow || textBeyondUsableWidth || textBeyondUsableHeight) {
    bugs.push(
      makeBugReport(
        button,
        "button-text-overflow",
        [
          horizontalOverflow ? `scrollWidth ${button.scrollWidth} > clientWidth ${button.clientWidth}` : "",
          verticalOverflow ? `scrollHeight ${button.scrollHeight} > clientHeight ${button.clientHeight}` : "",
          textBeyondUsableWidth
            ? `text width ${button.contentBox.textWidth} > usable width ${button.contentBox.usableWidth}`
            : "",
          textBeyondUsableHeight
            ? `text height ${button.contentBox.textHeight} > usable height ${button.contentBox.usableHeight}`
            : "",
        ]
          .filter(Boolean)
          .join("; "),
      ),
    );
  }

  if ((clipsHorizontal && horizontalOverflow) || (clipsVertical && verticalOverflow)) {
    bugs.push(
      makeBugReport(
        button,
        "button-text-clipping",
        [
          clipsHorizontal && horizontalOverflow
            ? `overflow-x is ${button.css.overflowX} while scrollWidth ${button.scrollWidth} > clientWidth ${button.clientWidth}`
            : "",
          clipsVertical && verticalOverflow
            ? `overflow-y is ${button.css.overflowY} while scrollHeight ${button.scrollHeight} > clientHeight ${button.clientHeight}`
            : "",
        ]
          .filter(Boolean)
          .join("; "),
      ),
    );
  }

  return {
    status: bugs.length > 0 ? "BUG" : "PASS",
    button,
    bugs,
  };
}

export function calculateMetrics(results: ButtonResult[]): Metrics {
  const expectedBugButtons = results.filter((result) => result.button.expected === "BUG");
  const expectedPassButtons = results.filter((result) => result.button.expected === "PASS");
  const truePositives = expectedBugButtons.filter((result) => result.status === "BUG").length;
  const falsePositives = expectedPassButtons.filter((result) => result.status === "BUG").length;
  const falseNegatives = expectedBugButtons.filter((result) => result.status === "PASS").length;

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives),
    recall: truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives),
  };
}

function makeBugReport(button: ButtonMeasurement, rule: RuleId, reason: string): BugReport {
  return {
    button: {
      index: button.index,
      text: button.text,
      accessibleName: button.accessibleName,
      selector: button.selector,
      tag: button.tag,
      role: button.role,
    },
    rule,
    actualMeasurements: {
      boundingBox: button.boundingBox,
      clientWidth: button.clientWidth,
      clientHeight: button.clientHeight,
      scrollWidth: button.scrollWidth,
      scrollHeight: button.scrollHeight,
      contentBox: button.contentBox,
      css: button.css,
      parent: button.parent,
    },
    reason,
  };
}

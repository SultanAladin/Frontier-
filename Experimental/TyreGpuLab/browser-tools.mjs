export async function launchTestBrowser() {
  const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  );
  return chromium.launch({
    headless: true,
    args: JSON.parse(process.env.CHROMIUM_ARGS || "[]"),
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
    ...(process.env.CHROMIUM_IGNORE_DEFAULTS === "1"
      ? { ignoreDefaultArgs: true }
      : {}),
  });
}

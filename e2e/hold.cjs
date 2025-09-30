// Keep the process alive so Playwright's webServer has a live child process.
// It will be terminated by Playwright after tests.
setInterval(() => {}, 1 << 30)


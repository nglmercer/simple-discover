import { describe, it, expect, mock, afterEach } from "bun:test";
import { Logger, logger } from "../../src/modules/debug";

describe("Debug Logger Module", () => {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  afterEach(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    logger.disable();
  });

  it("should output when enabled", () => {
    let logCalled = false;
    let warnCalled = false;
    let errorCalled = false;

    console.log = () => { logCalled = true; };
    console.warn = () => { warnCalled = true; };
    console.error = () => { errorCalled = true; };

    logger.enable();
    logger.log("test");
    logger.warn("test");
    logger.error("test");

    expect(logCalled).toBe(true);
    expect(warnCalled).toBe(true);
    expect(errorCalled).toBe(true);
  });

  it("should not output when disabled", () => {
    let logCalled = false;
    let warnCalled = false;
    let errorCalled = false;

    console.log = () => { logCalled = true; };
    console.warn = () => { warnCalled = true; };
    console.error = () => { errorCalled = true; };

    logger.disable();
    logger.log("test");
    logger.warn("test");
    logger.error("test");

    expect(logCalled).toBe(false);
    expect(warnCalled).toBe(false);
    expect(errorCalled).toBe(false);
  });
});

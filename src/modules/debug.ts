export class Logger {
  private enabled = false;

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  log(...args: any[]) {
    if (this.enabled) console.log(...args);
  }

  warn(...args: any[]) {
    if (this.enabled) console.warn(...args);
  }

  error(...args: any[]) {
    if (this.enabled) console.error(...args);
  }
}

export const logger = new Logger();


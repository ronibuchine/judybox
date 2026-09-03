/** Concise by default; --verbose adds per-player events without flooding the summary. */
export class Logger {
  constructor(private readonly verbose: boolean) {}

  info(message: string): void {
    console.log(message);
  }

  detail(message: string): void {
    if (this.verbose) console.log(`  \u00b7 ${message}`);
  }

  warn(message: string): void {
    console.warn(`! ${message}`);
  }
}

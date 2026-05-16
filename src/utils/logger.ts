import chalk from 'chalk';

export const logger = {
  info: (msg: string) => console.log(chalk.hex('#6B7280')('  │  ') + chalk.hex('#9CA3AF')(msg)),
  success: (msg: string) => console.log(chalk.hex('#10B981')('  ✓  ') + chalk.hex('#D1D5DB').bold(msg)),
  error: (msg: string) => console.log(chalk.hex('#EF4444')('  ✕  ') + chalk.bgHex('#7F1D1D').hex('#FECACA').bold(' ERROR ') + ' ' + chalk.hex('#FCA5A5')(msg)),
  warn: (msg: string) => console.log(chalk.hex('#F59E0B')('  ⚠  ') + chalk.hex('#FCD34D')(msg)),
  step: (msg: string) => console.log(chalk.hex('#8B5CF6')('  →  ') + chalk.hex('#E5E7EB')(msg)),
  box: (title: string, msg: string) => {
    const border = chalk.hex('#374151');
    console.log(border('\n  ╭────────────────────────────────────────────────────────────────────────╮'));
    console.log(border('  │ ') + chalk.bold.hex('#F3F4F6')(title.padEnd(70)) + border(' │'));
    console.log(border('  ├────────────────────────────────────────────────────────────────────────┤'));
    msg.split('\n').forEach(line => {
      const visibleLength = line.replace(/\x1B\[\d+m/g, '').length; // strip ansi
      const padding = visibleLength < 70 ? ' '.repeat(70 - visibleLength) : '';
      console.log(border('  │ ') + line + padding + border(' │'));
    });
    console.log(border('  ╰────────────────────────────────────────────────────────────────────────╯\n'));
  }
};

export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentIdx = 0;

  constructor(private message: string) {}

  start() {
    process.stdout.write('\x1b[?25l'); // Hide cursor
    this.timer = setInterval(() => {
      process.stdout.write(`\r${chalk.blue(this.frames[this.currentIdx])} ${chalk.dim(this.message)}`);
      this.currentIdx = (this.currentIdx + 1) % this.frames.length;
    }, 80);
    this.timer.unref(); // Prevent the spinner from keeping the Node process alive
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write('\r\x1b[K'); // Clear line
      process.stdout.write('\x1b[?25h'); // Show cursor
    }
  }

  update(newMessage: string) {
    this.message = newMessage;
  }
}

export const CommandKind = Object.freeze({
  STOP: 'STOP',
  CONTROL: 'CONTROL',
  SPEED: 'SPEED',
  KEEP_ALIVE: 'KEEP_ALIVE',
});

/** @typedef {{kind: string, frame: Uint8Array, label: string}} Command */

/**
 * Decides which command is written next. The BLE link carries one write at a time, so commands
 * wait here: STOP jumps the queue and discards everything that was waiting, consecutive speed
 * changes collapse into the latest one, and keep-alives are only sent when nothing else is.
 */
export class CommandScheduler {
  /** @type {Command[]} */
  #pending = [];

  get isEmpty() {
    return this.#pending.length === 0;
  }

  /** @param {Command} command */
  submit(command) {
    switch (command.kind) {
      case CommandKind.STOP:
        this.#pending = [command];
        break;
      case CommandKind.SPEED:
        if (this.#pending.at(-1)?.kind === CommandKind.SPEED) this.#pending[this.#pending.length - 1] = command;
        else this.#pending.push(command);
        break;
      case CommandKind.CONTROL:
        this.#pending.push(command);
        break;
      case CommandKind.KEEP_ALIVE:
        if (this.#pending.length === 0) this.#pending.push(command);
        break;
      default:
        throw new Error(`Tipo de comando desconocido: ${command.kind}`);
    }
  }

  /** @returns {Command | null} */
  next() {
    return this.#pending.shift() ?? null;
  }

  clear() {
    this.#pending = [];
  }
}

// Errors raised by the spec writer. They carry fixed text and never a path.

/** Raised when a write would leave the allowed write set or touch a symbolic link. */
export class SpecWriteRefusedError extends Error {
  constructor() {
    super('That file cannot be written.');
    this.name = 'SpecWriteRefusedError';
  }
}

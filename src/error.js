export class MusicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

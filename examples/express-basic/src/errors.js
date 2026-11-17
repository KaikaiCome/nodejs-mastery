export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const Errors = {
  NotFound: (what) => new AppError('NOT_FOUND', `${what} not found`, 404),
  Conflict: (msg) => new AppError('CONFLICT', msg, 409),
  Validation: (msg) => new AppError('VALIDATION_ERROR', msg, 400)
}

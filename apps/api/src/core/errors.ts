/** Every error leaves the API as {code, message_th, details}. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    public messageTh: string,
    public details?: unknown,
  ) {
    super(`${code}: ${messageTh}`);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `ไม่พบ${what}`);
export const forbidden = (why = 'บทบาทนี้ไม่มีสิทธิ์ทำรายการนี้') => new AppError(403, 'FORBIDDEN', why);
export const unprocessable = (code: string, messageTh: string, details?: unknown) => new AppError(422, code, messageTh, details);
export const conflict = (code: string, messageTh: string, details?: unknown) => new AppError(409, code, messageTh, details);

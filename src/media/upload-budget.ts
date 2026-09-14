import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { finalize } from "rxjs";
import { Fault } from "../common/errors";
let active = 0;
@Injectable()
export class UploadBudget implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    if (active >= 2)
      throw new Fault("UPLOAD_BUSY", "图片处理繁忙，请稍后重试", 429);
    active++;
    try {
      return next.handle().pipe(
        finalize(() => {
          active--;
        }),
      );
    } catch (error) {
      active--;
      throw error;
    }
  }
}

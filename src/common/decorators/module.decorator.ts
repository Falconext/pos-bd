import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'module';
export const RequiresModule = (module: string) => SetMetadata(MODULE_KEY, module);

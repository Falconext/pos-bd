import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DespachoConfigDto {
    @IsOptional() @IsString() mensajeEnCamino?: string;
    @IsOptional() @IsString() mensajeEntregado?: string;
    @IsOptional() @IsBoolean() notificarEnCamino?: boolean;
    @IsOptional() @IsBoolean() notificarEntregado?: boolean;
}

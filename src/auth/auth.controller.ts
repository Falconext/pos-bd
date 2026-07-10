import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OauthSigninDto } from './dto/oauth-signin.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { Response } from 'express';
import { User } from '../common/decorators/user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('origin') origin: string,
  ) {
    const result = await this.authService.login(dto, origin);
    res.locals.message = 'Inicio de sesión exitoso';
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post('select-sede')
  async selectSede(
    @User() user: any,
    @Body('sedeId') sedeId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.selectSede(
      user.id ?? user.sub,
      Number(sedeId),
    );
    res.locals.message = 'Sede seleccionada correctamente';
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@User() user: any) {
    const usuario = await this.authService.obtenerUsuarioActual(
      user.id ?? user.sub,
    );
    return usuario;
  }

  @UseGuards(JwtAuthGuard)
  @Get('perfil')
  async perfil(@User() user: any) {
    const perfil = await this.authService.obtenerPerfilCompleto(
      user.id ?? user.sub,
    );
    return perfil;
  }

  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.refresh(dto.refreshToken);
    res.locals.message = 'Refresh exitoso';
    return tokens;
  }

  /**
   * Endpoint interno: intercambia una identidad OAuth ya verificada por
   * NextAuth en el portal de developers por los tokens del ERP. Protegido
   * por shared-secret (`OAUTH_SIGNIN_SECRET`) — solo el backend del portal
   * debe conocerlo.
   */
  @Post('oauth-signin')
  async oauthSignin(
    @Body() dto: OauthSigninDto,
    @Headers('x-oauth-signin-secret') sharedSecret: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = process.env.OAUTH_SIGNIN_SECRET;
    if (!expected || sharedSecret !== expected) {
      throw new ForbiddenException('oauth-signin secret inválido');
    }
    const result = await this.authService.oauthSignin(dto);
    res.locals.message = 'OAuth signin exitoso';
    return result;
  }

  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Headers('origin') origin?: string,
    @Headers('host') host?: string,
  ) {
    await this.authService.forgotPassword(dto.email, dto.brand, origin || host);
    return {
      message:
        'Si el correo existe, recibirás un enlace de recuperación en breve.',
    };
  }

  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return {
      message:
        'Contraseña actualizada correctamente. Ya puedes iniciar sesión.',
    };
  }
}

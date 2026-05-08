import { Body, Controller, Get, Headers, Post, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
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
    @Body() body: { sedeId: number },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.selectSede(
      user.id ?? user.sub,
      Number(body.sedeId),
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
}

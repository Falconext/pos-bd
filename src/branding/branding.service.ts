import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type PublicBranding = {
  key: string;
  authBrand: 'falconext' | 'krezka';
  isWhiteLabel: boolean;
  name: string;
  legalName: string;
  website: string;
  email: string;
  phone: string;
  whatsapp: string;
  logo: string;
  logoWhite: string;
  favicon?: string;
  primaryColor: string;
  secondaryColor: string;
  socials: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
  };
  dashboardUrl: string;
};

@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicBranding(inputHost?: string): Promise<PublicBranding> {
    const host = this.normalizeHost(inputHost);
    const baseBrand = this.getBaseBrandByHost(host);
    const defaults = this.getDefaults(baseBrand);

    let reseller = await this.prisma.reseller.findFirst({
      where: {
        activo: true,
        dominioPersonalizado: host,
      },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        dominioPersonalizado: true,
        whiteLabelNombre: true,
        whiteLabelLogoUrl: true,
        whiteLabelLogoWhiteUrl: true,
        whiteLabelFaviconUrl: true,
        whiteLabelColorPrimario: true,
        whiteLabelColorSecundario: true,
        whiteLabelWebsite: true,
        whiteLabelEmail: true,
        whiteLabelTelefono: true,
        whiteLabelWhatsapp: true,
      },
    });

    // Fallback for rows saved with protocol, www or port (legacy/manual data)
    if (!reseller) {
      const candidates = await this.prisma.reseller.findMany({
        where: {
          activo: true,
          dominioPersonalizado: { not: null },
        },
        select: {
          id: true,
          codigo: true,
          nombre: true,
          dominioPersonalizado: true,
          whiteLabelNombre: true,
          whiteLabelLogoUrl: true,
          whiteLabelLogoWhiteUrl: true,
          whiteLabelFaviconUrl: true,
          whiteLabelColorPrimario: true,
          whiteLabelColorSecundario: true,
          whiteLabelWebsite: true,
          whiteLabelEmail: true,
          whiteLabelTelefono: true,
          whiteLabelWhatsapp: true,
        },
      });

      reseller =
        candidates.find((item) => this.normalizeHost(item.dominioPersonalizado || '') === host) || null;
    }

    if (!reseller) {
      return defaults;
    }

    return {
      ...defaults,
      key: reseller.codigo?.toLowerCase?.() || `reseller-${reseller.id}`,
      isWhiteLabel: true,
      name: reseller.whiteLabelNombre || reseller.nombre || defaults.name,
      legalName: reseller.whiteLabelNombre || reseller.nombre || defaults.legalName,
      website: reseller.whiteLabelWebsite || defaults.website,
      email: reseller.whiteLabelEmail || defaults.email,
      phone: reseller.whiteLabelTelefono || defaults.phone,
      whatsapp: reseller.whiteLabelWhatsapp || defaults.whatsapp,
      logo: reseller.whiteLabelLogoUrl || defaults.logo,
      logoWhite: reseller.whiteLabelLogoWhiteUrl || reseller.whiteLabelLogoUrl || defaults.logoWhite,
      favicon: reseller.whiteLabelFaviconUrl || defaults.favicon,
      primaryColor: reseller.whiteLabelColorPrimario || defaults.primaryColor,
      secondaryColor: reseller.whiteLabelColorSecundario || defaults.secondaryColor,
      dashboardUrl: `https://${host}`,
    };
  }

  private normalizeHost(rawHost?: string): string {
    const source = String(rawHost || '').trim().toLowerCase();
    const stripped = source
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split(':')[0];
    return stripped;
  }

  private getBaseBrandByHost(host: string): 'falconext' | 'krezka' {
    if (host.includes('krezka')) return 'krezka';
    return 'falconext';
  }

  private getDefaults(base: 'falconext' | 'krezka'): PublicBranding {
    if (base === 'krezka') {
      return {
        key: 'krezka',
        authBrand: 'krezka',
        isWhiteLabel: false,
        name: 'Krezka',
        legalName: 'Krezka Soluciones Digitales',
        website: 'https://krezka.com',
        email: 'ventas@krezka.com',
        phone: '+51 932 332 556',
        whatsapp: '51932332556',
        logo: '/assets/krezka/krezka.png',
        logoWhite: '/assets/krezka/krezkawhite.png',
        favicon: '/favicon.ico',
        primaryColor: '#00D0D4',
        secondaryColor: '#00A0A4',
        socials: { facebook: '#', instagram: '#' },
        dashboardUrl: 'https://app.krezka.com',
      };
    }

    return {
      key: 'falconext',
      authBrand: 'falconext',
      isWhiteLabel: false,
      name: 'Falconext',
      legalName: 'Falconext S.A.C.',
      website: 'https://falconext.pe',
      email: 'ventas@falconext.pe',
      phone: '+51 932 332 556',
      whatsapp: '51932332556',
      logo: '/assets/fnlogo.png',
      logoWhite: '/assets/logofalconwhite.png',
      favicon: '/favicon.ico',
      primaryColor: '#3E2BC7',
      secondaryColor: '#5A45D1',
      socials: {
        facebook: 'https://www.facebook.com/profile.php?id=61576185915016',
        instagram: 'https://www.instagram.com/falconext.pe/',
      },
      dashboardUrl: 'https://app.falconext.pe',
    };
  }
}

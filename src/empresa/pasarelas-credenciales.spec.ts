/**
 * QA del guardado de credenciales de pasarela desde Perfil.
 *
 * La regla que importa: el formulario nunca muestra la clave secreta (no sale
 * del servidor), así que el usuario guarda con ese campo en blanco cada vez que
 * cambia otra cosa —el interruptor, el modo demo—. Si un blanco borrara la
 * clave, la tienda dejaría de cobrar sin que nadie se entere.
 */
import { cifrarSecreto, descifrarSecreto } from '../common/utils/secreto.util';

/** Réplica de cómo el service arma el update con lo que llega del formulario. */
const armarUpdate = (dto: Record<string, any>) => {
  const updateData: Record<string, any> = {};
  if (dto.culqiPublicKey !== undefined)
    updateData.culqiPublicKey = dto.culqiPublicKey?.trim() || null;
  if (dto.culqiSecretKey?.trim())
    updateData.culqiSecretKey = cifrarSecreto(dto.culqiSecretKey.trim());
  if (dto.culqiActivo !== undefined)
    updateData.culqiActivo = Boolean(dto.culqiActivo);
  if (dto.niubizMerchantId !== undefined)
    updateData.niubizMerchantId = dto.niubizMerchantId?.trim() || null;
  if (dto.niubizUsuario !== undefined)
    updateData.niubizUsuario = dto.niubizUsuario?.trim() || null;
  if (dto.niubizPassword?.trim())
    updateData.niubizPassword = cifrarSecreto(dto.niubizPassword.trim());
  if (dto.niubizActivo !== undefined)
    updateData.niubizActivo = Boolean(dto.niubizActivo);
  if (dto.pasarelasUsaDemo !== undefined)
    updateData.pasarelasUsaDemo = Boolean(dto.pasarelasUsaDemo);
  return updateData;
};

describe('Perfil · guardar credenciales de las pasarelas', () => {
  it('guarda la primera vez: público en claro, secreto cifrado', () => {
    const u = armarUpdate({
      culqiPublicKey: ' pk_test_abc ',
      culqiSecretKey: ' sk_test_abc ',
      culqiActivo: true,
    });
    expect(u.culqiPublicKey).toBe('pk_test_abc');
    expect(u.culqiSecretKey).toMatch(/^v1:/);
    expect(descifrarSecreto(u.culqiSecretKey)).toBe('sk_test_abc');
    expect(u.culqiActivo).toBe(true);
  });

  it('volver a guardar con la clave en blanco NO toca la clave guardada', () => {
    const u = armarUpdate({
      culqiPublicKey: 'pk_test_abc',
      culqiSecretKey: '',
      culqiActivo: false,
      niubizPassword: '   ',
      niubizActivo: false,
    });
    expect(u).not.toHaveProperty('culqiSecretKey');
    expect(u).not.toHaveProperty('niubizPassword');
    // Lo demás sí se actualiza: apagar la pasarela tiene que funcionar.
    expect(u.culqiActivo).toBe(false);
    expect(u.niubizActivo).toBe(false);
  });

  it('cambiar de clave sí la reemplaza', () => {
    const u = armarUpdate({ niubizPassword: 'clave-nueva' });
    expect(descifrarSecreto(u.niubizPassword)).toBe('clave-nueva');
  });

  it('el código de comercio de Niubiz se guarda limpio y vacío queda en null', () => {
    expect(armarUpdate({ niubizMerchantId: ' 456879852 ' }).niubizMerchantId).toBe('456879852');
    expect(armarUpdate({ niubizMerchantId: '' }).niubizMerchantId).toBeNull();
  });

  it('el interruptor de pruebas viaja como booleano, no como texto', () => {
    expect(armarUpdate({ pasarelasUsaDemo: false }).pasarelasUsaDemo).toBe(false);
    expect(armarUpdate({ pasarelasUsaDemo: true }).pasarelasUsaDemo).toBe(true);
  });

  it('un guardado que no menciona las pasarelas no las modifica', () => {
    expect(armarUpdate({ razonSocial: 'OTRA COSA' })).toEqual({});
  });
});

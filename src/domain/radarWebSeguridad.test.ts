import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { validarDestinoWeb } from '../../api/radar-web';

const pedir = (cuerpo: unknown, token = 'A'.repeat(80)) => handler(new Request('https://ulit-censo.example/api/radar-web', {
  method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(cuerpo),
}));
afterEach(() => vi.restoreAllMocks());

describe('Radar web: seguridad de destinos y acceso',()=>{
  it('admite solamente URL HTTPS pública, nunca IP/localhost, puertos o credenciales',()=>{
    expect(validarDestinoWeb('https://example.com/').hostname).toBe('example.com');
    for(const url of [
      'http://www.google.com','http://127.0.0.1',
      'https://127.0.0.1/','https://192.168.1.1','https://[::1]/',
      'https://localhost/','https://metadatos.local/',
      'https://web.example/','file:///etc/passwd',
      'https://usuario:password@www.example.com/',
      'https://www.example.com:8443/',
    ]) expect(()=>validarDestinoWeb(url)).toThrow();
  });
  it('exige sesión y POST: el endpoint no es un proxy público',async()=>{
    const sinSesion=await handler(new Request('https://ulit-censo.example/api/radar-web',{
      method:'POST',body:JSON.stringify({accion:'paginas',urls:['https://google.com/']}),
    }));
    expect(sinSesion.status).toBe(401);
    const metodo=await handler(new Request('https://ulit-censo.example/api/radar-web',{method:'GET'}));
    expect(metodo.status).toBe(405);
  });
  it('valida cada acción antes de tocar la red: nada inválido sale del servidor',async()=>{
    const red=vi.spyOn(globalThis,'fetch');
    expect((await pedir({accion:'paginas',urls:['https://127.0.0.1/']})).status).toBe(400);
    expect((await pedir({accion:'paginas',urls:['https://a.es/','https://b.es/','https://c.es/','https://d.es/','https://e.es/']})).status).toBe(400);
    expect((await pedir({accion:'paginas',urls:[]})).status).toBe(400);
    expect((await pedir({accion:'osm',municipio:'"];out;'})).status).toBe(400);
    expect((await pedir({accion:'osm',municipio:''})).status).toBe(400);
    expect((await pedir({accion:'osm',municipio:'Medina del Campo',provincia:'x"];out;'})).status).toBe(400);
    expect((await pedir({accion:'marcas',ids:['Q1);drop']})).status).toBe(400);
    expect((await pedir({accion:'marcas',ids:Array.from({length:41},(_,i)=>'Q'+(i+1))})).status).toBe(400);
    expect((await pedir({accion:'borrar'})).status).toBe(400);
    expect((await pedir([1,2])).status).toBe(400);
    expect(red).not.toHaveBeenCalled();
  });
  it('rechaza solicitudes demasiado grandes',async()=>{
    expect((await pedir({accion:'paginas',urls:['https://a.es/'],relleno:'x'.repeat(7000)})).status).toBe(413);
  });
});

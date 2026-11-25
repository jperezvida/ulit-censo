import { describe, expect, it } from 'vitest';
import handler, { validarDestinoWeb } from '../../api/radar-web';

describe('Radar web: seguridad de destinos y acceso al piloto',()=>{
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
  it('exige sesión: el endpoint no es un proxy público de URLs',async()=>{
    const sinSesion=await handler(new Request('https://ulit-censo.example/api/radar-web',{
      method:'POST',body:JSON.stringify({url:'https://google.com/'}),
    }));
    expect(sinSesion.status).toBe(401);
    const metodo=await handler(new Request('https://ulit-censo.example/api/radar-web',{method:'GET'}));
    expect(metodo.status).toBe(405);
    const token='A'.repeat(80);
    const interna=await handler(new Request('https://ulit-censo.example/api/radar-web',{
      method:'POST',headers:{authorization:'Bearer '+token},
      body:JSON.stringify({url:'https://127.0.0.1/'}),
    }));
    expect(interna.status).toBe(400);
  });
});

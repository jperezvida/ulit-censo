import { beforeEach, describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import {
  negociosPilotoRadar, enlacesBusquedaRadar, leerBorradoresRadar, normalizarPerfilRadar, CLAVE_RADAR,
} from './radarDigitalIT1';

function fixture(){
  const db=baseVacia();
  db.municipios.medina={id:'medina',nombre:'Medina del Campo',provincia:'Valladolid',fuenteCallejero:'simulado'};
  db.campanas.c26={
    id:'c26',municipioId:'medina',anio:2026,nombre:'Censo 2026',
    tipo:'actualizacion',periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],
    estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},
    procedencia:'importado',
  };
  db.campanas.c25={...db.campanas.c26,id:'c25',anio:2025,tipo:'historico-importado'};
  db.itinerarios.it1={
    id:'it1',campanaId:'c26',codigo:'IT1',nombre:'IT1',
    origen:'excel',color:'#123',tramos:[],asignadosIds:[],creado:'2026-10-01',
  };
  db.importaciones.imp={
    id:'imp',campanaId:'c26',municipioId:'medina',tipo:'C-excel-itinerario',
    archivo:'IT1.xlsx',huella:'abc',fecha:'2026-10-01',filas:105,estado:'confirmada',
    resumen:{},procedencia:'importado',
  };
  for(let n=1;n<=105;n++){
    const vacio=n>66;
    db.registros['r'+n]={
      id:'r'+n,importacionId:'imp',itinerarioId:'it1',fila:n+1,
      datos:{
        'Nombre del negocio':vacio?'':'Negocio ficticio '+n,'Local Vacío':vacio?'1':'0',
        'Dirección':'Calle Ejemplo','Num':'5','web':n%2?'0':'1',
        'Instagram':'','Google My Bussines':'1',
      },
    };
  }
  return db;
}
beforeEach(()=>localStorage.clear());

describe('Radar Digital: selección del piloto',()=>{
  it('selecciona exactamente 10 negocios ocupados de IT1/2026 sin tocar el Excel',()=>{
    const db=fixture();
    const before=JSON.stringify(db.registros);
    const casos=negociosPilotoRadar(db,'c26');
    expect(casos).toHaveLength(10);
    expect(casos[0]).toMatchObject({id:'r1',nombre:'Negocio ficticio 1',fila:2});
    expect(casos[9].id).toBe('r10');
    expect(casos.every(x=>x.datosExcel.web==='0'||x.datosExcel.web==='1')).toBe(true);
    expect(negociosPilotoRadar(db,'c25')).toEqual([]);
    expect(JSON.stringify(db.registros)).toBe(before);
  });
  it('prepara búsquedas manuales con nombre, calle y municipio (camino manual más corto)',()=>{
    const links=enlacesBusquedaRadar({nombre:'La Óptica',direccion:'Calle Mayor',numero:'12'});
    expect(decodeURIComponent(links.web)).toContain('Medina del Campo');
    expect(decodeURIComponent(links.especifica.instagram)).toContain('site:instagram.com');
    expect(links.google).toContain('google.com/maps/search');
  });
  it('regresión «Heladería La Flor Medinense»: la búsqueda de X es amplia y no exige calle ni solo x.com',()=>{
    const links=enlacesBusquedaRadar({nombre:'Heladería La Flor Medinense',direccion:'Calle Ficticia',numero:'1'});
    expect(links.twitter).toBe('https://www.google.com/search?q='+encodeURIComponent('Heladería La Flor Medinense twitter'));
    expect(decodeURIComponent(links.twitter)).not.toContain('Calle Ficticia');
    expect(decodeURIComponent(links.especifica.twitter)).toBe('https://www.google.com/search?q="Heladería La Flor Medinense" (site:twitter.com OR site:x.com)');
    expect(decodeURIComponent(links.instagram)).toBe('https://www.google.com/search?q=Heladería La Flor Medinense instagram');
  });
});

describe('Radar Digital: perfiles seguros',()=>{
  it('bloquea enlaces de compartir, javascript y sitios ajenos a la plataforma',()=>{
    expect(normalizarPerfilRadar('instagram','javascript:alert(1)')).toBeNull();
    expect(normalizarPerfilRadar('instagram','https://www.instagram.com/p/foto')).toBeNull();
    expect(normalizarPerfilRadar('facebook','https://facebook.com/sharer/sharer.php?u=x')).toBeNull();
    expect(normalizarPerfilRadar('instagram','https://instagram.com.evil.es/tienda')).toBeNull();
    expect(normalizarPerfilRadar('instagram','http://instagram.com/tienda')).toBeNull();
    expect(normalizarPerfilRadar('facebook','https://www.facebook.com/tienda?ref=nav'))
      .toBe('https://www.facebook.com/tienda');
  });
  it('conserva el identificador de perfiles de Facebook sin nombre de usuario',()=>{
    expect(normalizarPerfilRadar('facebook','https://www.facebook.com/profile.php?id=1000123456&ref=x'))
      .toBe('https://www.facebook.com/profile.php?id=1000123456');
    expect(normalizarPerfilRadar('facebook','https://www.facebook.com/profile.php')).toBeNull();
  });
  it('sanea el borrador del piloto anterior y nunca revalida por cargarlo',()=>{
    localStorage.setItem(CLAVE_RADAR+':c26',JSON.stringify({r1:{
      sitioWeb:'https://ejemplo.es/',webValidada:false,
      hallazgo:{urlFinal:'https://ejemplo.es/',
        redes:{instagram:'javascript:alert(1)',facebook:'https://www.facebook.com/tienda/'},
        indiciosVenta:[]},
      redesValidadas:{instagram:true},ventaOnline:'pendiente',estado:'pendiente',actualizado:'',
    }}));
    const c=leerBorradoresRadar('c26').r1;
    expect(c.hallazgo?.redes.instagram).toBeUndefined();
    expect(c.hallazgo?.redes.facebook).toBe('https://www.facebook.com/tienda/');
    expect(c.redesValidadas.instagram).toBe(false);
    expect(c.webValidada).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import {
  negociosPilotoRadar, interpretarPresenciaExcel, enlacesBusquedaRadar,
  leerBorradoresRadar, guardarBorradoresRadar, resumenPilotoRadar,
} from './radarDigitalIT1';
import { extraerEnlacesPublicos } from './radarAnalisisWeb';

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
describe('Radar Digital gratuito: selección y borradores',()=>{
  it('selecciona exactamente 10 negocios ocupados de las filas originales de IT1',()=>{
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
  it('distingue NO original de ausencia de dato y no fabrica negativos a partir de búsquedas',()=>{
    expect(interpretarPresenciaExcel('1')).toBe('si');
    expect(interpretarPresenciaExcel('0')).toBe('no');
    expect(interpretarPresenciaExcel('')).toBe('sin-dato');
    expect(interpretarPresenciaExcel('Sin verificar')).toBe('sin-dato');
    const links=enlacesBusquedaRadar({nombre:'La Óptica',direccion:'Calle Mayor',numero:'12'});
    expect(decodeURIComponent(links.web)).toContain('Medina del Campo');
    expect(decodeURIComponent(links.instagram)).toContain('site:instagram.com');
  });
  it('guarda provisionalmente en el navegador y reabre solo datos de ese piloto',()=>{
    const entrada={r1:{
      sitioWeb:'https://comercio-ficticio.es/', webValidada:true,
      hallazgo:{urlFinal:'https://comercio-ficticio.es/',redes:{instagram:'https://www.instagram.com/ficticio/'},indiciosVenta:[]},
      redesValidadas:{instagram:true},ventaOnline:'pendiente' as const,
      estado:'revisado' as const,actualizado:'2026-11-25T12:00:00.000Z',
    }};
    expect(guardarBorradoresRadar('c26',entrada)).toBe(true);
    expect(leerBorradoresRadar('c26').r1).toMatchObject({estado:'revisado',webValidada:true});
    expect(leerBorradoresRadar('c25')).toEqual({});
    expect(resumenPilotoRadar(negociosPilotoRadar(fixture(),'c26'),entrada))
      .toMatchObject({total:10,finalizados:1,pendientes:9,conWeb:1});
  });
});

describe('Radar Digital: extracción de enlaces reales, sin afirmaciones automáticas',()=>{
  it('extrae redes enlazadas desde la web oficial e indicios de tienda',()=>{
    const html=`<html><body>
      <a href="/contacto">Contacto</a>
      <a href="https://www.instagram.com/comercio/">Instagram</a>
      <a href="https://www.facebook.com/comercio.ficticio?ref=menu">Facebook</a>
      <a href="https://x.com/comercio">X</a>
      <div class="woocommerce"></div><a href="/checkout">Comprar</a>
    </body></html>`;
    const r=extraerEnlacesPublicos(html,'https://comercio-ficticio.es/');
    expect(r.redes.instagram).toBe('https://www.instagram.com/comercio/');
    expect(r.redes.facebook).toBe('https://www.facebook.com/comercio.ficticio');
    expect(r.redes.twitter).toBe('https://x.com/comercio');
    expect(r.indiciosVenta).toContain('Tecnología de tienda (WooCommerce)');
    expect(r.indiciosVenta).toContain('Enlace a carrito o pago');
  });
  it('no interpreta enlaces para compartir contenidos como perfiles ni presume ausencia de redes',()=>{
    const html=`<a href="https://twitter.com/intent/tweet?url=https://uno.es">Compartir</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=https://uno.es">Facebook</a>
      <a href="https://www.instagram.com/p/ABCD123/">Publicación</a>`;
    const r=extraerEnlacesPublicos(html,'https://uno.es/');
    expect(r.redes).toEqual({});
    expect(r.indiciosVenta).toEqual([]);
  });
  it('no interpreta HTML de un comercio como un valor confirmado del censo',()=>{
    const r=extraerEnlacesPublicos('<p>Consulte nuestra web</p>','https://comercio-ficticio.es/');
    expect(r.redes).toEqual({});
    expect(r.indiciosVenta).toEqual([]);
  });
});

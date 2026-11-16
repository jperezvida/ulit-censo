-- 0016 · Revisión HUMANA de clasificación en Excel de itinerarios 2026.
-- Los registros ocupados sin conciliar se revisan igualmente, una decisión POR FILA.
-- El origen 2026 y el histórico 2025 son inmutables.
begin;

create table if not exists ulit_censo.catalogo_nodos_2026 (
  id text primary key,
  grupo text not null,
  comercio text not null,
  subgrupo text not null,
  actividad text not null,
  ruta text not null
);
revoke all on table ulit_censo.catalogo_nodos_2026 from public, anon, authenticated;

insert into ulit_censo.catalogo_nodos_2026
  (id,grupo,comercio,subgrupo,actividad,ruta)
values
  ('c26.C.A.carnes','Comercio','Alimentación','Carnes','','Comercio › Alimentación › Carnes'),
  ('c26.C.A.carnes.carniceria','Comercio','Alimentación','Carnes','Carnicería','Comercio › Alimentación › Carnes › Carnicería'),
  ('c26.C.A.carnes.charcuteria','Comercio','Alimentación','Carnes','Charcutería','Comercio › Alimentación › Carnes › Charcutería'),
  ('c26.C.A.carnes.polleria','Comercio','Alimentación','Carnes','Pollería','Comercio › Alimentación › Carnes › Pollería'),
  ('c26.C.A.carnes.casqueria','Comercio','Alimentación','Carnes','Casquería','Comercio › Alimentación › Carnes › Casquería'),
  ('c26.C.A.pescados-y-mariscos','Comercio','Alimentación','Pescados y mariscos','','Comercio › Alimentación › Pescados y mariscos'),
  ('c26.C.A.pescados-y-mariscos.pescaderia','Comercio','Alimentación','Pescados y mariscos','Pescadería','Comercio › Alimentación › Pescados y mariscos › Pescadería'),
  ('c26.C.A.pescados-y-mariscos.marisco','Comercio','Alimentación','Pescados y mariscos','Marisco','Comercio › Alimentación › Pescados y mariscos › Marisco'),
  ('c26.C.A.fruta-y-verdura','Comercio','Alimentación','Fruta y verdura','','Comercio › Alimentación › Fruta y verdura'),
  ('c26.C.A.fruta-y-verdura.fruteria','Comercio','Alimentación','Fruta y verdura','Frutería','Comercio › Alimentación › Fruta y verdura › Frutería'),
  ('c26.C.A.pan-y-lacteos','Comercio','Alimentación','Pan y Lácteos','','Comercio › Alimentación › Pan y Lácteos'),
  ('c26.C.A.pan-y-lacteos.panaderia','Comercio','Alimentación','Pan y Lácteos','Panadería','Comercio › Alimentación › Pan y Lácteos › Panadería'),
  ('c26.C.A.pan-y-lacteos.pasteleria','Comercio','Alimentación','Pan y Lácteos','Pastelería','Comercio › Alimentación › Pan y Lácteos › Pastelería'),
  ('c26.C.A.pan-y-lacteos.heladeria','Comercio','Alimentación','Pan y Lácteos','Heladería','Comercio › Alimentación › Pan y Lácteos › Heladería'),
  ('c26.C.A.pan-y-lacteos.queseria','Comercio','Alimentación','Pan y Lácteos','Quesería','Comercio › Alimentación › Pan y Lácteos › Quesería'),
  ('c26.C.A.alimentacion-seca','Comercio','Alimentación','Alimentación Seca','','Comercio › Alimentación › Alimentación Seca'),
  ('c26.C.A.alimentacion-seca.comida-preparada','Comercio','Alimentación','Alimentación Seca','Comida preparada','Comercio › Alimentación › Alimentación Seca › Comida preparada'),
  ('c26.C.A.alimentacion-seca.congelados','Comercio','Alimentación','Alimentación Seca','Congelados','Comercio › Alimentación › Alimentación Seca › Congelados'),
  ('c26.C.A.alimentacion-seca.golosinas','Comercio','Alimentación','Alimentación Seca','Golosinas','Comercio › Alimentación › Alimentación Seca › Golosinas'),
  ('c26.C.A.alimentacion-seca.productos-delicatesen','Comercio','Alimentación','Alimentación Seca','Productos delicatesen','Comercio › Alimentación › Alimentación Seca › Productos delicatesen'),
  ('c26.C.A.alimentacion-seca.ultramarinos','Comercio','Alimentación','Alimentación Seca','Ultramarinos','Comercio › Alimentación › Alimentación Seca › Ultramarinos'),
  ('c26.C.A.alimentacion-seca.bebidas','Comercio','Alimentación','Alimentación Seca','Bebidas','Comercio › Alimentación › Alimentación Seca › Bebidas'),
  ('c26.C.A.alimentacion-seca.dietetica','Comercio','Alimentación','Alimentación Seca','Dietética','Comercio › Alimentación › Alimentación Seca › Dietética'),
  ('c26.C.A.gran-establecimiento','Comercio','Alimentación','Gran establecimiento','','Comercio › Alimentación › Gran establecimiento'),
  ('c26.C.A.gran-establecimiento.supermercados','Comercio','Alimentación','Gran establecimiento','Supermercados','Comercio › Alimentación › Gran establecimiento › Supermercados'),
  ('c26.C.A.gran-establecimiento.hipermercados','Comercio','Alimentación','Gran establecimiento','Hipermercados','Comercio › Alimentación › Gran establecimiento › Hipermercados'),
  ('c26.C.EP.ropa','Comercio','Equipamiento Personal','Ropa','','Comercio › Equipamiento Personal › Ropa'),
  ('c26.C.EP.ropa.moda','Comercio','Equipamiento Personal','Ropa','Moda','Comercio › Equipamiento Personal › Ropa › Moda'),
  ('c26.C.EP.ropa.moda-hombre','Comercio','Equipamiento Personal','Ropa','Moda Hombre','Comercio › Equipamiento Personal › Ropa › Moda Hombre'),
  ('c26.C.EP.ropa.moda-mujer','Comercio','Equipamiento Personal','Ropa','Moda Mujer','Comercio › Equipamiento Personal › Ropa › Moda Mujer'),
  ('c26.C.EP.ropa.moda-deportiva','Comercio','Equipamiento Personal','Ropa','Moda deportiva','Comercio › Equipamiento Personal › Ropa › Moda deportiva'),
  ('c26.C.EP.ropa.moda-infantil-y-bebe','Comercio','Equipamiento Personal','Ropa','Moda infantil y bebé','Comercio › Equipamiento Personal › Ropa › Moda infantil y bebé'),
  ('c26.C.EP.ropa.merceria-y-lenceria','Comercio','Equipamiento Personal','Ropa','Mercería y lencería','Comercio › Equipamiento Personal › Ropa › Mercería y lencería'),
  ('c26.C.EP.ropa.segunda-mano','Comercio','Equipamiento Personal','Ropa','Segunda mano','Comercio › Equipamiento Personal › Ropa › Segunda mano'),
  ('c26.C.EP.ropa.trabajo','Comercio','Equipamiento Personal','Ropa','Trabajo','Comercio › Equipamiento Personal › Ropa › Trabajo'),
  ('c26.C.EP.ropa.ceremonia','Comercio','Equipamiento Personal','Ropa','Ceremonia','Comercio › Equipamiento Personal › Ropa › Ceremonia'),
  ('c26.C.EP.calzado','Comercio','Equipamiento Personal','Calzado','','Comercio › Equipamiento Personal › Calzado'),
  ('c26.C.EP.calzado.calzado','Comercio','Equipamiento Personal','Calzado','Calzado','Comercio › Equipamiento Personal › Calzado › Calzado'),
  ('c26.C.EP.calzado.calzado-hombre','Comercio','Equipamiento Personal','Calzado','Calzado Hombre','Comercio › Equipamiento Personal › Calzado › Calzado Hombre'),
  ('c26.C.EP.calzado.calzado-mujer','Comercio','Equipamiento Personal','Calzado','Calzado Mujer','Comercio › Equipamiento Personal › Calzado › Calzado Mujer'),
  ('c26.C.EP.calzado.calzado-infantil','Comercio','Equipamiento Personal','Calzado','Calzado infantil','Comercio › Equipamiento Personal › Calzado › Calzado infantil'),
  ('c26.C.EP.complementos','Comercio','Equipamiento Personal','Complementos','','Comercio › Equipamiento Personal › Complementos'),
  ('c26.C.EP.complementos.accesorios','Comercio','Equipamiento Personal','Complementos','Accesorios','Comercio › Equipamiento Personal › Complementos › Accesorios'),
  ('c26.C.EP.complementos.joyerias','Comercio','Equipamiento Personal','Complementos','Joyerías','Comercio › Equipamiento Personal › Complementos › Joyerías'),
  ('c26.C.EH.electrodomesticos','Comercio','Equipamiento del Hogar','Electrodomésticos','','Comercio › Equipamiento del Hogar › Electrodomésticos'),
  ('c26.C.EH.electrodomesticos.electrodomesticos','Comercio','Equipamiento del Hogar','Electrodomésticos','Electrodomésticos','Comercio › Equipamiento del Hogar › Electrodomésticos › Electrodomésticos'),
  ('c26.C.EH.mobiliario','Comercio','Equipamiento del Hogar','Mobiliario','','Comercio › Equipamiento del Hogar › Mobiliario'),
  ('c26.C.EH.mobiliario.mobiliario','Comercio','Equipamiento del Hogar','Mobiliario','Mobiliario','Comercio › Equipamiento del Hogar › Mobiliario › Mobiliario'),
  ('c26.C.EH.ropa-del-hogar','Comercio','Equipamiento del Hogar','Ropa del hogar','','Comercio › Equipamiento del Hogar › Ropa del hogar'),
  ('c26.C.EH.ropa-del-hogar.ropa-del-hogar','Comercio','Equipamiento del Hogar','Ropa del hogar','Ropa del hogar','Comercio › Equipamiento del Hogar › Ropa del hogar › Ropa del hogar'),
  ('c26.C.EH.materiales-de-construccion','Comercio','Equipamiento del Hogar','Materiales de construcción','','Comercio › Equipamiento del Hogar › Materiales de construcción'),
  ('c26.C.EH.materiales-de-construccion.cristalerias','Comercio','Equipamiento del Hogar','Materiales de construcción','Cristalerías','Comercio › Equipamiento del Hogar › Materiales de construcción › Cristalerías'),
  ('c26.C.EH.materiales-de-construccion.puertas-y-ventanas','Comercio','Equipamiento del Hogar','Materiales de construcción','Puertas y ventanas','Comercio › Equipamiento del Hogar › Materiales de construcción › Puertas y ventanas'),
  ('c26.C.EH.materiales-de-construccion.materiales-de-obra','Comercio','Equipamiento del Hogar','Materiales de construcción','Materiales de obra','Comercio › Equipamiento del Hogar › Materiales de construcción › Materiales de obra'),
  ('c26.C.EH.materiales-de-construccion.revestimientos','Comercio','Equipamiento del Hogar','Materiales de construcción','Revestimientos','Comercio › Equipamiento del Hogar › Materiales de construcción › Revestimientos'),
  ('c26.C.EH.iluminacion-y-electricidad','Comercio','Equipamiento del Hogar','Iluminación y electricidad','','Comercio › Equipamiento del Hogar › Iluminación y electricidad'),
  ('c26.C.EH.iluminacion-y-electricidad.iluminacion-y-electricidad','Comercio','Equipamiento del Hogar','Iluminación y electricidad','Iluminación y electricidad','Comercio › Equipamiento del Hogar › Iluminación y electricidad › Iluminación y electricidad'),
  ('c26.C.EH.decoracion-y-enmarcacion','Comercio','Equipamiento del Hogar','Decoración y enmarcación','','Comercio › Equipamiento del Hogar › Decoración y enmarcación'),
  ('c26.C.EH.decoracion-y-enmarcacion.decoracion-y-enmarcacion','Comercio','Equipamiento del Hogar','Decoración y enmarcación','Decoración y enmarcación','Comercio › Equipamiento del Hogar › Decoración y enmarcación › Decoración y enmarcación'),
  ('c26.C.EH.bricolaje-y-ferreterias','Comercio','Equipamiento del Hogar','Bricolaje y ferreterías','','Comercio › Equipamiento del Hogar › Bricolaje y ferreterías'),
  ('c26.C.EH.bricolaje-y-ferreterias.bricolaje-y-ferreterias','Comercio','Equipamiento del Hogar','Bricolaje y ferreterías','Bricolaje y ferreterías','Comercio › Equipamiento del Hogar › Bricolaje y ferreterías › Bricolaje y ferreterías'),
  ('c26.C.EH.bazar-y-menaje','Comercio','Equipamiento del Hogar','Bazar y menaje','','Comercio › Equipamiento del Hogar › Bazar y menaje'),
  ('c26.C.EH.bazar-y-menaje.bazar','Comercio','Equipamiento del Hogar','Bazar y menaje','Bazar','Comercio › Equipamiento del Hogar › Bazar y menaje › Bazar'),
  ('c26.C.OE.vehiculos-y-maquinaria','Comercio','Otros equipamientos','Vehículos y maquinaria','','Comercio › Otros equipamientos › Vehículos y maquinaria'),
  ('c26.C.OE.vehiculos-y-maquinaria.concesionarios','Comercio','Otros equipamientos','Vehículos y maquinaria','Concesionarios','Comercio › Otros equipamientos › Vehículos y maquinaria › Concesionarios'),
  ('c26.C.OE.vehiculos-y-maquinaria.repuestos','Comercio','Otros equipamientos','Vehículos y maquinaria','Repuestos','Comercio › Otros equipamientos › Vehículos y maquinaria › Repuestos'),
  ('c26.C.OE.vehiculos-y-maquinaria.maquinaria','Comercio','Otros equipamientos','Vehículos y maquinaria','Maquinaria','Comercio › Otros equipamientos › Vehículos y maquinaria › Maquinaria'),
  ('c26.C.OE.vehiculos-y-maquinaria.bicis-y-patinetes','Comercio','Otros equipamientos','Vehículos y maquinaria','Bicis y patinetes','Comercio › Otros equipamientos › Vehículos y maquinaria › Bicis y patinetes'),
  ('c26.C.OE.perfumeria-y-drogueria','Comercio','Otros equipamientos','Perfumería y droguería','','Comercio › Otros equipamientos › Perfumería y droguería'),
  ('c26.C.OE.perfumeria-y-drogueria.perfumeria-y-cosmetica','Comercio','Otros equipamientos','Perfumería y droguería','Perfumería y cosmética','Comercio › Otros equipamientos › Perfumería y droguería › Perfumería y cosmética'),
  ('c26.C.OE.perfumeria-y-drogueria.drogueria','Comercio','Otros equipamientos','Perfumería y droguería','Droguería','Comercio › Otros equipamientos › Perfumería y droguería › Droguería'),
  ('c26.C.OE.perfumeria-y-drogueria.articulos-peluqueria','Comercio','Otros equipamientos','Perfumería y droguería','Artículos peluquería','Comercio › Otros equipamientos › Perfumería y droguería › Artículos peluquería'),
  ('c26.C.OE.estancos','Comercio','Otros equipamientos','Estancos','','Comercio › Otros equipamientos › Estancos'),
  ('c26.C.OE.estancos.estancos','Comercio','Otros equipamientos','Estancos','Estancos','Comercio › Otros equipamientos › Estancos › Estancos'),
  ('c26.C.OE.salud','Comercio','Otros equipamientos','Salud','','Comercio › Otros equipamientos › Salud'),
  ('c26.C.OE.salud.farmacias','Comercio','Otros equipamientos','Salud','Farmacias','Comercio › Otros equipamientos › Salud › Farmacias'),
  ('c26.C.OE.salud.ortopedias','Comercio','Otros equipamientos','Salud','Ortopedias','Comercio › Otros equipamientos › Salud › Ortopedias'),
  ('c26.C.OE.salud.opticas','Comercio','Otros equipamientos','Salud','Ópticas','Comercio › Otros equipamientos › Salud › Ópticas'),
  ('c26.C.OE.salud.audifonos','Comercio','Otros equipamientos','Salud','Audífonos','Comercio › Otros equipamientos › Salud › Audífonos'),
  ('c26.C.OE.ocio','Comercio','Otros equipamientos','Ocio','','Comercio › Otros equipamientos › Ocio'),
  ('c26.C.OE.ocio.floristeria-y-jardineria','Comercio','Otros equipamientos','Ocio','Floristería y jardinería','Comercio › Otros equipamientos › Ocio › Floristería y jardinería'),
  ('c26.C.OE.ocio.jugueterias','Comercio','Otros equipamientos','Ocio','Jugueterías','Comercio › Otros equipamientos › Ocio › Jugueterías'),
  ('c26.C.OE.ocio.papeleria-prensa-y-libreria','Comercio','Otros equipamientos','Ocio','Papelería, prensa y librería','Comercio › Otros equipamientos › Ocio › Papelería, prensa y librería'),
  ('c26.C.OE.ocio.coleccionismo','Comercio','Otros equipamientos','Ocio','Coleccionismo','Comercio › Otros equipamientos › Ocio › Coleccionismo'),
  ('c26.C.OE.ocio.musica','Comercio','Otros equipamientos','Ocio','Música','Comercio › Otros equipamientos › Ocio › Música'),
  ('c26.C.OE.ocio.informatica','Comercio','Otros equipamientos','Ocio','Informática','Comercio › Otros equipamientos › Ocio › Informática'),
  ('c26.C.OE.ocio.fotografia-y-audiovisual','Comercio','Otros equipamientos','Ocio','Fotografía y audiovisual','Comercio › Otros equipamientos › Ocio › Fotografía y audiovisual'),
  ('c26.C.OE.otros-bienes','Comercio','Otros equipamientos','Otros bienes','','Comercio › Otros equipamientos › Otros bienes'),
  ('c26.C.OE.otros-bienes.regalos','Comercio','Otros equipamientos','Otros bienes','Regalos','Comercio › Otros equipamientos › Otros bienes › Regalos'),
  ('c26.C.OE.otros-bienes.mascotas','Comercio','Otros equipamientos','Otros bienes','Mascotas','Comercio › Otros equipamientos › Otros bienes › Mascotas'),
  ('c26.C.OE.otros-bienes.oficina','Comercio','Otros equipamientos','Otros bienes','Oficina','Comercio › Otros equipamientos › Otros bienes › Oficina'),
  ('c26.C.OE.otros-bienes.otros','Comercio','Otros equipamientos','Otros bienes','Otros','Comercio › Otros equipamientos › Otros bienes › Otros'),
  ('c26.C.OE.grandes-almacenes','Comercio','Otros equipamientos','Grandes Almacenes','','Comercio › Otros equipamientos › Grandes Almacenes'),
  ('c26.C.OE.grandes-almacenes.corte-ingles','Comercio','Otros equipamientos','Grandes Almacenes','Corte Inglés','Comercio › Otros equipamientos › Grandes Almacenes › Corte Inglés'),
  ('c26.H.bares-y-cafeterias','Hostelería y Restauración','','Bares y cafeterías','','Hostelería y Restauración › Bares y cafeterías'),
  ('c26.H.bares-y-cafeterias.bar','Hostelería y Restauración','','Bares y cafeterías','Bar','Hostelería y Restauración › Bares y cafeterías › Bar'),
  ('c26.H.bares-y-cafeterias.cafeteria','Hostelería y Restauración','','Bares y cafeterías','Cafetería','Hostelería y Restauración › Bares y cafeterías › Cafetería'),
  ('c26.H.bares-y-cafeterias.taberna','Hostelería y Restauración','','Bares y cafeterías','Taberna','Hostelería y Restauración › Bares y cafeterías › Taberna'),
  ('c26.H.bares-y-cafeterias.bodega','Hostelería y Restauración','','Bares y cafeterías','Bodega','Hostelería y Restauración › Bares y cafeterías › Bodega'),
  ('c26.H.bares-y-cafeterias.chocolateria','Hostelería y Restauración','','Bares y cafeterías','Chocolatería','Hostelería y Restauración › Bares y cafeterías › Chocolatería'),
  ('c26.H.bares-y-cafeterias.pub','Hostelería y Restauración','','Bares y cafeterías','Pub','Hostelería y Restauración › Bares y cafeterías › Pub'),
  ('c26.H.bares-y-cafeterias.otros','Hostelería y Restauración','','Bares y cafeterías','Otros','Hostelería y Restauración › Bares y cafeterías › Otros'),
  ('c26.H.restaurantes','Hostelería y Restauración','','Restaurantes','','Hostelería y Restauración › Restaurantes'),
  ('c26.H.restaurantes.tradicional','Hostelería y Restauración','','Restaurantes','Tradicional','Hostelería y Restauración › Restaurantes › Tradicional'),
  ('c26.H.restaurantes.comida-rapida','Hostelería y Restauración','','Restaurantes','Comida rápida','Hostelería y Restauración › Restaurantes › Comida rápida'),
  ('c26.H.restaurantes.internacional','Hostelería y Restauración','','Restaurantes','Internacional','Hostelería y Restauración › Restaurantes › Internacional'),
  ('c26.H.restaurantes.otros','Hostelería y Restauración','','Restaurantes','Otros','Hostelería y Restauración › Restaurantes › Otros'),
  ('c26.H.restaurantes.catering','Hostelería y Restauración','','Restaurantes','Catering','Hostelería y Restauración › Restaurantes › Catering'),
  ('c26.H.hoteles-y-hospedaje','Hostelería y Restauración','','Hoteles y hospedaje','','Hostelería y Restauración › Hoteles y hospedaje'),
  ('c26.H.hoteles-y-hospedaje.hotel','Hostelería y Restauración','','Hoteles y hospedaje','Hotel','Hostelería y Restauración › Hoteles y hospedaje › Hotel'),
  ('c26.H.hoteles-y-hospedaje.hostal','Hostelería y Restauración','','Hoteles y hospedaje','Hostal','Hostelería y Restauración › Hoteles y hospedaje › Hostal'),
  ('c26.H.hoteles-y-hospedaje.pension','Hostelería y Restauración','','Hoteles y hospedaje','Pensión','Hostelería y Restauración › Hoteles y hospedaje › Pensión'),
  ('c26.H.hoteles-y-hospedaje.b-b','Hostelería y Restauración','','Hoteles y hospedaje','B&B','Hostelería y Restauración › Hoteles y hospedaje › B&B'),
  ('c26.H.hoteles-y-hospedaje.residencia-estudiantil','Hostelería y Restauración','','Hoteles y hospedaje','Residencia estudiantil','Hostelería y Restauración › Hoteles y hospedaje › Residencia estudiantil'),
  ('c26.H.hoteles-y-hospedaje.albergue','Hostelería y Restauración','','Hoteles y hospedaje','Albergue','Hostelería y Restauración › Hoteles y hospedaje › Albergue'),
  ('c26.H.hoteles-y-hospedaje.pisos-turisticos','Hostelería y Restauración','','Hoteles y hospedaje','Pisos turísticos','Hostelería y Restauración › Hoteles y hospedaje › Pisos turísticos'),
  ('c26.H.discotecas','Hostelería y Restauración','','Discotecas','','Hostelería y Restauración › Discotecas'),
  ('c26.S.banca-y-finanzas','Servicios','','Banca y finanzas','','Servicios › Banca y finanzas'),
  ('c26.S.servicios-medicos','Servicios','','Servicios médicos','','Servicios › Servicios médicos'),
  ('c26.S.otros-servicios-profesionales','Servicios','','Otros servicios profesionales','','Servicios › Otros servicios profesionales'),
  ('c26.S.educacion','Servicios','','Educación','','Servicios › Educación'),
  ('c26.S.practica-deportiva','Servicios','','Práctica deportiva','','Servicios › Práctica deportiva'),
  ('c26.S.correos-y-mensajeria','Servicios','','Correos y mensajería','','Servicios › Correos y mensajería'),
  ('c26.S.loterias-y-apuestas','Servicios','','Loterías y apuestas','','Servicios › Loterías y apuestas'),
  ('c26.S.organismos-oficiales','Servicios','','Organismos Oficiales','','Servicios › Organismos Oficiales'),
  ('c26.S.asociaciones','Servicios','','Asociaciones','','Servicios › Asociaciones'),
  ('c26.S.comunicaciones','Servicios','','Comunicaciones','','Servicios › Comunicaciones'),
  ('c26.S.agencias-de-viajes','Servicios','','Agencias de viajes','','Servicios › Agencias de viajes'),
  ('c26.S.inmobiliarias','Servicios','','Inmobiliarias','','Servicios › Inmobiliarias'),
  ('c26.S.instalaciones-y-suministros','Servicios','','Instalaciones y suministros','','Servicios › Instalaciones y suministros'),
  ('c26.S.construccion','Servicios','','Construcción','','Servicios › Construcción'),
  ('c26.S.limpiezas','Servicios','','Limpiezas','','Servicios › Limpiezas'),
  ('c26.S.tintorerias','Servicios','','Tintorerías','','Servicios › Tintorerías'),
  ('c26.S.peluquerias','Servicios','','Peluquerías','','Servicios › Peluquerías'),
  ('c26.S.estetica-y-belleza','Servicios','','Estética y belleza','','Servicios › Estética y belleza'),
  ('c26.S.telefonia','Servicios','','Telefonía','','Servicios › Telefonía'),
  ('c26.S.reparaciones','Servicios','','Reparaciones','','Servicios › Reparaciones'),
  ('c26.S.automovil','Servicios','','Automóvil','','Servicios › Automóvil'),
  ('c26.S.ocio-y-cines','Servicios','','Ocio y cines','','Servicios › Ocio y cines'),
  ('c26.S.religiosos','Servicios','','Religiosos','','Servicios › Religiosos'),
  ('c26.S.patrimonio-historico','Servicios','','Patrimonio histórico','','Servicios › Patrimonio histórico'),
  ('c26.S.mascotas','Servicios','','Mascotas','','Servicios › Mascotas'),
  ('c26.S.almacenaje-y-guardamuebles','Servicios','','Almacenaje y guardamuebles','','Servicios › Almacenaje y guardamuebles')
on conflict (id) do update set
  grupo=excluded.grupo, comercio=excluded.comercio, subgrupo=excluded.subgrupo,
  actividad=excluded.actividad, ruta=excluded.ruta;

-- El servidor sólo admite la nueva colección por la RPC restringida;
-- la escritura general del espacio real sigue desactivada.
create or replace function ulit_censo.coleccion_valida(c text)
returns boolean language sql immutable set search_path='' as $body$
  select c = any (array[
    '_raiz','municipios','calles','campanas','itinerarios','coberturas','situacionesPrevias',
    'callesRevisadasPlan','locales','negocios','ocupaciones','observaciones','registros','vinculos',
    'importaciones','revisiones','digital','clasificaciones','franquicias',
    'oficinaItinerarios','personas','correccionesRegistros','revisionesCategoriaRegistros'
  ]);
$body$;

create or replace function public.ulit_censo_categoria_registro_2026(
  p_espacio text,
  p_accion text,
  p_version_esperada bigint,
  p_registro_id text,
  p_nodo_id text,
  p_descripcion text
) returns jsonb
language plpgsql security definer
set search_path=''
set statement_timeout='60s'
as $func$
declare
  v_m ulit_censo.miembro;
  v_e ulit_censo.espacio;
  v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
  v_reg jsonb;
  v_imp jsonb;
  v_prev jsonb;
  v_cor jsonb;
  v_nodo ulit_censo.catalogo_nodos_2026;
  v_actual jsonb;
  v_id text;
  v_lv text;
  v_nombre text;
  v_fecha text;
  v_version bigint;
  v_copia uuid;
  v_valores jsonb;
  v_grupo text;
  v_estado text;
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026'
     or p_accion not in ('estado','aceptar','rechazar','corregir') then
    raise exception 'ULIT Censo: categorización fuera de alcance'
      using errcode='42501';
  end if;

  -- Mismo criterio de autorización que la revisión general; nada de usuario_metadata.
  v_m := ulit_censo.exigir(p_espacio,array['administrador','coordinador']);

  if p_accion = 'estado' then
    select * into v_e from ulit_censo.espacio where id=p_espacio;
  else
    select * into v_e from ulit_censo.espacio where id=p_espacio for update;
  end if;
  if not found or v_e.tipo <> 'real' or v_e.version < 8
     or v_e.escritura_habilitada or v_e.preparacion_habilitada then
    raise exception 'ULIT Censo: espacio real no verificable o con escritura general abierta'
      using errcode='42501';
  end if;
  if not exists(select 1 from ulit_censo.entidad where espacio_id=p_espacio
      and coleccion='campanas' and id=v_camp and valor->>'anio'='2026') then
    raise exception 'ULIT Censo: campaña 2026 no disponible'
      using errcode='42501';
  end if;
  if p_accion='estado' then
    return pg_catalog.jsonb_build_object(
      'habilitada',true,'version',v_e.version,
      'catalogo','clasificacion-2026@v1',
      'alcance','clasificacion-por-fila-2026',
      'respaldoAutomatico',true);
  end if;

  if p_version_esperada is null or p_version_esperada <> v_e.version then
    raise exception 'ULIT Censo: el censo cambió; recarga antes de guardar'
      using errcode='PT409';
  end if;
  if p_registro_id is null or pg_catalog.length(p_registro_id) not between 5 and 350
     or p_descripcion is null or pg_catalog.length(p_descripcion) > 250
     or p_nodo_id is null or pg_catalog.length(p_nodo_id) > 180 then
    raise exception 'ULIT Censo: datos de clasificación incorrectos'
      using errcode='22023';
  end if;
  select valor into v_reg from ulit_censo.entidad where espacio_id=p_espacio
    and coleccion='registros' and id=p_registro_id;
  if v_reg is null or v_reg ? 'exclusion' then
    raise exception 'ULIT Censo: fila no autorizada' using errcode='42501';
  end if;
  v_id := v_reg->>'itinerarioId';
  select valor into v_imp from ulit_censo.entidad where espacio_id=p_espacio
    and coleccion='importaciones' and id=v_reg->>'importacionId';
  if v_imp is null or v_imp->>'campanaId' is distinct from v_camp
    or v_imp->>'estado' is distinct from 'confirmada'
    or v_imp->>'tipo' not in ('C-excel-itinerario','D-actualizacion')
    or not exists(select 1 from ulit_censo.entidad where espacio_id=p_espacio
      and coleccion='itinerarios' and id=v_id and valor->>'campanaId'=v_camp) then
    raise exception 'ULIT Censo: la fila no pertenece a un itinerario confirmado de 2026'
      using errcode='42501';
  end if;
  select valor into v_cor from ulit_censo.entidad where espacio_id=p_espacio
    and coleccion='correccionesRegistros' and id=p_registro_id;
  v_lv := coalesce(v_cor->'valores'->>'vacio',
    v_reg->'original'->'vacio'->>'v',v_reg->'datos'->>'Local Vacío','');
  v_nombre := pg_catalog.btrim(coalesce(v_cor->'valores'->>'nombre',
    v_reg->'original'->'nombre'->>'v',v_reg->'datos'->>'Nombre del negocio',''));
  if v_lv <> '0' or v_nombre='' or pg_catalog.lower(v_nombre) = any(array[
      'lv','l.v.','vacio','vacío','local vacío','local vacio','sin ocupante','sin actividad'
    ]) then
    raise exception 'ULIT Censo: solo se categorizan los locales ocupados con nombre'
      using errcode='42501';
  end if;

  select valor into v_prev from ulit_censo.entidad where espacio_id=p_espacio
    and coleccion='revisionesCategoriaRegistros' and id=p_registro_id;
  if v_prev is not null and
     (v_prev->>'campanaId' is distinct from v_camp
      or v_prev->>'itinerarioId' is distinct from v_id
      or v_prev->>'registroId' is distinct from p_registro_id) then
    raise exception 'ULIT Censo: clasificación previa incoherente' using errcode='42501';
  end if;

  -- Propuesta anterior es solo referencia y se puede rechazar. No se confirma sola.
  v_grupo := pg_catalog.btrim(coalesce(v_cor->'valores'->>'grupoActividad',
      v_reg->'original'->'grupoActividad'->>'v',v_reg->'datos'->>'GrActividad',''));
  if p_accion='aceptar' and v_grupo='' then
    raise exception 'ULIT Censo: no existe categorización que aceptar'
      using errcode='22023';
  end if;

  if p_accion='rechazar' then
    if p_nodo_id <> '' or p_descripcion <> '' then
      raise exception 'ULIT Censo: rechazar no admite nueva categoría'
        using errcode='22023';
    end if;
    v_valores := '{}'::jsonb;
    v_estado := 'rechazada';
  else
    select * into v_nodo from ulit_censo.catalogo_nodos_2026 where id=p_nodo_id;
    if not found or v_nodo.subgrupo='' then
      raise exception 'ULIT Censo: clasificación ajena al catálogo oficial 2026'
        using errcode='22023';
    end if;
    -- Si hay actividades más concretas, elegir una o describir por qué se usa el subgrupo.
    if exists(select 1 from ulit_censo.catalogo_nodos_2026 n
      where n.id like p_nodo_id || '.%')
      and pg_catalog.btrim(p_descripcion)='' then
      raise exception 'ULIT Censo: el subgrupo requiere actividad o descripción'
        using errcode='22023';
    end if;
    v_valores := pg_catalog.jsonb_build_object(
      'grupoActividad',v_nodo.grupo,'grupoComercio',v_nodo.comercio,
      'subgrupo',v_nodo.subgrupo,'actividad',v_nodo.actividad,
      'descripcionActividad',pg_catalog.btrim(p_descripcion));
    v_estado := case when p_accion='aceptar' then 'aceptada' else 'corregida' end;
  end if;

  -- Copia íntegra de la versión vigente ANTES de la primera aprobación categorial.
  -- La creación es atómica y no actualiza la versión. No se repite por cada fila.
  if not exists (select 1 from ulit_censo.entidad where espacio_id=p_espacio
      and coleccion='revisionesCategoriaRegistros') then
    v_copia := public.ulit_censo_crear_copia(
      p_espacio,'Antes de comenzar revisión de clasificación 2026');
    if not exists (select 1 from ulit_censo.copia where id=v_copia and espacio_id=p_espacio
        and version=v_e.version and sha256 ~ '^[0-9a-f]{64}$' and bytes > 0
        and contenido->>'espacioId'=p_espacio and contenido->>'version'=v_e.version::text
        and contenido->>'tipo'='real') then
      raise exception 'ULIT Censo: copia previa no verificada; no se ha guardado'
        using errcode='42501';
    end if;
  end if;

  v_fecha := pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_actual := pg_catalog.jsonb_build_object(
    'id',p_registro_id,'registroId',p_registro_id,'campanaId',v_camp,
    'itinerarioId',v_id,'nombreRevisado',v_nombre,'catalogoId','clasificacion-2026@v1',
    'nodoId',case when p_accion='rechazar' then null else p_nodo_id end,
    'descripcion',pg_catalog.btrim(p_descripcion),'valores',v_valores,
    'estado',v_estado,'fecha',v_fecha,'porId',v_m.persona_id);
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  v_version := ulit_censo.aplicar_interno(v_m,p_espacio,p_version_esperada,
    'Oficina 2026 · categorización revisada de una fila',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'c','revisionesCategoriaRegistros','id',p_registro_id,'v',v_actual)));
  update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio;
  return pg_catalog.jsonb_build_object('version',v_version,
    'registroId',p_registro_id,'itinerarioId',v_id,'accion',p_accion,
    'revision',v_actual);
end;
$func$;

revoke all on function public.ulit_censo_categoria_registro_2026(
  text,text,bigint,text,text,text) from public,anon;
grant execute on function public.ulit_censo_categoria_registro_2026(
  text,text,bigint,text,text,text) to authenticated;

commit;
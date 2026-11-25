# Presentación de Diseños

Página web para mostrarle al cliente la cocina, el placar o el vanitory en **3D**, con las
**texturas** del dibujo y las **cotas que pusiste en SketchUp**. Le mandás **un link** por
WhatsApp, lo abre, lo gira con el dedo o el mouse y ve las medidas. No instala nada ni necesita
cuenta, y **solo puede mirar**: no hay nada en esa pantalla que cambie el diseño.

Es la hermana de [Control de piezas](../Control%20de%20Piezas/LEEME.md): aquella es para la fábrica,
esta es para vender.

## Cómo se usa

1. En SketchUp, poné las cotas con la herramienta **Acotar** (y, si querés, textos con flecha para
   aclarar materiales).
2. Botón **Exportar para Presentación de Diseños** (barra propia, menú Archivo o
   Extensiones → Presentación de Diseños).
3. Te pregunta **en qué carpeta** lo querés guardar. Deja ahí una carpeta con el nombre del modelo
   (sirve cualquier carpeta: del disco, de red, de un pendrive o de OneDrive):

   ```
   <la carpeta que elegiste>\<Nombre del modelo>\
       modelo.dae
       cotas.json
       (todas las imágenes de las texturas, sueltas en la misma carpeta)
   ```

   Se acuerda de la última carpeta que usaste, así la próxima vez es un clic.
4. En la página: **+ Nueva propuesta → Elegir la carpeta entera** → esa carpeta. (O arrastrá la
   carpeta sobre el visor.) El nombre, el cliente y las notas se completan solos. Si preferís,
   abajo están los campos separados: **Modelo**, **Texturas** y **Cotas**, como en Control de
   piezas, para cargar los archivos uno por uno.
5. Cuando esté como querés, **Link para el cliente**: te copia el link al portapapeles, listo
   para pegar en el WhatsApp. (También está el botón **Enviar por WhatsApp**, que abre el chat
   con el mensaje armado.)

### Sin cuenta y sin contraseña

La página **no pide correo ni contraseña, nunca**. Tocás el botón y el link queda copiado, listo
para pegar en el WhatsApp. Lo que se puede hacer y lo que no lo deciden las reglas del servidor,
no una cuenta.

Si una propuesta ya está publicada y no la tocaste, el botón ni siquiera habla con el servidor:
copia el link y listo.

Esas reglas se pusieron una sola vez, con los archivos [SACAR-LA-CONTRASEÑA.sql](SACAR-LA-CONTRASEÑA.sql)
y [PASO-2-FALTABA-ESTO.sql](PASO-2-FALTABA-ESTO.sql), pegados en el editor SQL de Supabase. Si algún
día el botón del link dejara de andar diciendo que el servidor no autoriza, es que alguien las
borró: se vuelven a pegar y listo. Adentro de cada archivo está explicado qué abre, qué no, y cómo
volver atrás.

**La contracara:** la clave pública de la página está a la vista en su código, así que alguien que
la saque podría subir archivos al servidor y llenar el giga del plan gratis, o pedir la lista de
los trabajos subidos. No puede borrar nada, ni ver la tabla con los nombres de tus clientes y las
notas, ni tocar Control de piezas.

### Si el cliente no puede abrir el link

En **Ajustes** está **Guardar archivo para el cliente**: arma un solo `.html` (unos 4 MB) con el
visor, el modelo, las texturas y las cotas adentro. Se manda por WhatsApp **como archivo** y se
abre con doble clic, sin internet y sin cuenta. Sirve cuando el cliente tiene mala señal o la
empresa le bloquea páginas.

### Si corregís el diseño

Exportalo de nuevo a la misma carpeta (pisa lo anterior) y volvé a cargarlo en la página: como el
modelo lleva su propio número adentro del `.skp`, la página **actualiza la misma propuesta** y
**el link que ya tiene el cliente sigue siendo el mismo**. Te lo avisa antes de abrir. Después
tocá otra vez **Link para el cliente** para que el cliente vea la versión nueva.

## Lo que ve el cliente

- Gira, acerca y mueve el mueble con el dedo o el mouse.
- Botones de vista: **3D, Frente, Izq, Der, Planta, Atrás**, **Encuadrar** y **Ortogonal**
  (sin perspectiva, como un plano).
- **Cotas**: se dibujan como en SketchUp — línea fina negra con punta de flecha en cada extremo y
  el número en negrita apoyado sobre la línea. Se muestran u ocultan, y si en SketchUp usás varias etiquetas (capas) para las cotas,
  puede elegir cuáles ver.
- **Abrir puertas y cajones**: doble clic (o doble toque en el celular) sobre una puerta o un cajón
  lo abre o lo cierra — la puerta gira 90°, el cajón sale 30 cm con los costados y el fondo. El
  botón **Abrir** las mueve todas de una. Así el cliente ve los estantes y el interior.
- **Medir**: toca dos puntos del mueble y le dice cuánto hay (se engancha a las esquinas).
- **Foto**: guarda la vista como imagen, con las cotas dibujadas.
- Panel **Medidas**: ancho, alto y profundidad generales, la lista de cotas, los módulos con sus
  medidas y los materiales usados. Tocando un módulo, el resto se transparenta.

## Cotas: cómo salen bien

- Se leen de las **cotas de SketchUp** (herramienta Acotar), también las que estén dentro de
  grupos o componentes.
- Las cotas en **capas ocultas no se exportan**: así podés tener cotas de taller que el cliente no
  ve. Poné las del cliente en una capa (por ejemplo "Cotas generales") y las internas en otra.
- Los **textos con flecha** de SketchUp llegan como carteles ("Melamina Gris Textil", "Mesada
  granito negro").
- En **Ajustes** de la página elegís cómo se escriben: milímetros (2400), centímetros, metros
  (2,40) o *como en SketchUp*.
- **Cliente y notas**: se pueden escribir en la página, o dejarlos guardados en el .skp con
  Extensiones → Presentación de Diseños → **Cliente y notas del trabajo**; así viajan solos en el
  `cotas.json`.

## Puertas y cajones: cómo salen bien

Se reconocen por el **nombre del grupo en SketchUp**, igual que en Control de piezas:

- **"Puerta…"** gira sobre la bisagra. **"Frente…"** o **"Cajón…"** sale hacia adelante.
- Lo que diga **"fijo", "portahorno", "zócalo", "división", "divisor", "tabique"** o **"separador"**
  no se mueve, aunque el nombre tenga la palabra puerta ("División isla lado puertas").
- Las **partes del cajón** (costados, faja, fondo, guías) salen solas con su frente: se agrupan por
  posición — lo que está justo detrás del frente, dentro de su ancho y su alto — y, si no,
  por nombre.
- Un grupo que adentro tiene piezas con nombre propio se abre y se mira pieza por pieza, así un
  módulo llamado "ALACENA 2 PUERTAS" no gira entero como si fuera una puerta.

**Sentido de apertura:** se usa la bisagra del lado de afuera del módulo, y en la ficha figura
*(automático)*. Si alguna sale al revés, doble clic sobre ella y elegí **Izquierda, Derecha, Arriba
o Abajo** (en los cajones, **Adelante** o **Atrás**); si algo se mueve y no debería, **No se mueve**.
Queda guardado en la propuesta y **el cliente lo ve igual** — acordate de tocar **Link para el
cliente** después de cambiarlo. Ese cuadro solo lo ves vos: el cliente abre y cierra, nada más.

## Cómo se ve (el botón "Realista")

El visor no dibuja el modelo plano como SketchUp: lo ilumina como un render.

- **Luz de estudio:** un ambiente con techo iluminado y una ventana lateral cálida. Es lo que le
  da a la melamina el degradé suave en vez del brillo plano. Casi toda la luz la pone ese ambiente
  y no un foco: un foco fuerte le pega de frente a la puerta que estás mirando, le quema el color
  y la textura se va a beige lavado. Con la luz repartida, un roble se ve del color del roble.
- **Sombras en los rincones:** donde se encuentran dos placas, o adentro de un mueble, la luz se
  apaga sola. Es lo que más "arma" la sensación de volumen.
- **Acabado según el nombre del material:** el visor lee el nombre que pusiste en SketchUp y le da
  el brillo que corresponde — *laca/brillante* espeja, *melamina/mate* apaga, *acero/inox/alumin*
  es metálico, *granito/mármol/cuarzo* tiene barniz, *madera/roble/nogal* lleva veta, *vidrio* es
  transparente. Cuanto mejor nombres los materiales, mejor se ve.
- **Relieve:** las superficies lisas llevan un poro finito de melamina (a escala real, 22 cm el
  dibujo) y las que tienen textura reciben relieve sacado de la propia imagen, así la veta se ve
  con profundidad y no como una calcomanía.
- **Curva de exposición** de cámara de fotos: los blancos no se queman.

**Si un material se ve de un color raro, el color sale del material en SketchUp, no de la luz.** El
visor muestra exactamente el color que tiene pintada la cara. Si pintás los materiales con colores
de etiqueta para el despiece (por ejemplo "Melamina Blanco" en amarillo, "Filo 2mm" en verde), el
cliente los va a ver amarillos y verdes. Para la presentación conviene que el color pintado se
parezca al material de verdad, o directamente ponerle la textura: el **nombre** manda para el
brillo, pero el **color** se muestra tal cual.

**El celeste que tapaba todo** (`#a2b7c6`) era otra cosa, y ya está arreglado en la página.
SketchUp guarda en el `.dae` **cada cara dos veces**: una copia con el material del frente y otra
con el del dorso, pegadas en el mismo lugar. Cuando pintás sólo del lado que se ve, la copia de
atrás queda con el celeste que SketchUp usa para lo que no está pintado. El visor dibujaba las dos
caras de cada triángulo, así que la copia celeste tapaba a la pintada y la cocina entera salía
celeste. Ahora, cuando detecta esos pares, dibuja **una sola cara** de cada triángulo: cada lado
muestra lo suyo. Funciona con las carpetas que ya tenías exportadas, no hace falta reexportar.

El botón **Realista** lo prende y apaga. En celulares flojos arranca apagado (el cálculo de
rincones es lo más pesado); prendelo si la cosa va fluida.

## Texturas

- El plugin exporta siempre con **mapas de textura** y deja las imágenes sueltas junto al `.dae`
  (no en la subcarpeta que hace SketchUp), para poder seleccionarlas todas juntas.
- Las fotos importadas en SketchUp como **"Imagen"** (electrodomésticos, cuadros) no salen en el
  .dae. Para que aparezcan: clic derecho sobre la foto → **Explotar**, y exportá de nuevo.
- En el visor se ven con filtro anisotrópico y mipmaps: las vetas de la madera se leen nítidas
  aunque mires el mueble de costado.

## Instalar el plugin de SketchUp

SketchUp → **Extensiones → Extension Manager → Instalar extensión** → elegir
[PresentacionDisenos.rbz](PresentacionDisenos.rbz). Una sola vez por computadora.
El código está en [sketchup-plugin/](sketchup-plugin/).

En el menú **Extensiones → Presentación de Diseños** también están:
**Abrir la última carpeta exportada**, **Cliente y notas del trabajo** y **Ver el registro**
(un .log con el paso a paso de cada exportación, por si algo falla).

## Dónde se guarda todo

- **Las propuestas quedan en el navegador de esta computadora** (en el selector de arriba están
  todas). Al servidor sube solo lo que publicás con el botón del link.
- El link lleva un **número al azar**: solo llega quien lo recibe, pero cualquiera que lo tenga
  entra. Si se lo mandaste a quien no debías, **Ajustes → Eliminar propuesta**: la ficha del
  servidor se pisa con una marca de baja y el que abra el link ve "ya no está disponible".
- El servidor es el mismo Supabase de Control de piezas (`campimapas-produccion`), con prefijo
  `pd_`: tabla `pd_proyectos` y bucket `pd-modelos`. Plan gratis: 50 MB por archivo, 1 GB en
  total, y el proyecto se pausa si pasa una semana sin usarse.
- Si formateás la máquina o borrás los datos del navegador, se pierden las propuestas. **La copia
  que importa es la carpeta que dejó SketchUp** (con el `modelo.dae`, las texturas y el
  `cotas.json`): guardala vos donde guardás los trabajos y podés volver a cargarla cuando quieras.
- El archivo `.html` que le mandaste a un cliente sigue andando aunque borres la propuesta.
- Si un modelo pesa mucho: purgá los componentes que no uses (Ventana → Información del modelo →
  Estadísticas → Purgar) y achicá las texturas grandes. Eso también achica el archivo del cliente.

## Publicar una versión nueva de la página

Subí el número de `CACHE` en [sw.js](sw.js) y el de `APP_VER` en [app.js](app.js), volvé a armar
`presentacion-disenos-web.zip` y arrastralo en Netlify → proyecto **presentacion-disenos-campi** →
**Deploys**. En el zip va solo la página: no metas los .sql, la carpeta `Diseños` ni los .skp.

La página **se actualiza sola**: cuando encuentra una versión nueva se recarga sin que hagas nada
(revisa al abrir, al volver a la pestaña y cada diez minutos). Ya no hace falta Ctrl+F5. Para saber
qué versión estás viendo: **Ajustes**, abajo de todo dice *Versión de la página*.
## Dejarla como app en el teléfono

Abrí https://presentacion-disenos-campi.netlify.app y tocá **Instalar la app**, arriba a la derecha.
Queda el ícono en la pantalla de inicio y se abre sin barra del navegador, como cualquier otra app.
Sigue siendo la misma página: se actualiza sola y las propuestas son las mismas.

- **Android y computadora:** el botón la instala de una.
- **iPhone:** Apple no deja instalar desde un botón, así que el botón te muestra los dos pasos:
  **Compartir** → **Añadir a pantalla de inicio**.
- El botón **no aparece** si ya está instalada, ni en el link del cliente (el cliente solo mira).

El **ícono** es un mueble en 3D con su cota abajo, sobre fondo claro — a propósito distinto del de
Control de piezas (placas apiladas sobre fondo oscuro), para no confundirlos en la pantalla.

## Notas

- Poné nombre a cada grupo o componente en SketchUp: ese nombre es el que aparece en **Módulos**.
  Si cada mueble es un componente con su nombre ("Bajo mesada 1", "Alacena izquierda"), el panel de
  medidas queda listo para mostrar.



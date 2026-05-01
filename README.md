
# Futbol7 Clean Studio

Versión simplificada y más visual de la app.

## Qué cambió

- Menos secciones: Inicio, Jugadores, Partido 7v7, Videos y Ajustes.
- Diseño más limpio y moderno.
- Ya no hay botón "Generar IA".
- Ya no necesita API paga.
- Al subir la foto se genera automáticamente una presentación más limpia del jugador.
- Se eliminó el uniforme gigante superpuesto que tapaba la foto.

## Usuarios

Admin:

```text
admin / admin123
```

Usuario:

```text
usuario / user123
```

## Ejecutar

Dentro de la carpeta del proyecto:

```bash
python backend/server.py
```

Abre:

```text
http://localhost:3000
```

## Si el puerto 3000 está ocupado

Windows PowerShell:

```powershell
$env:PORT=5050
python backend/server.py
```

Windows CMD:

```cmd
set PORT=5050
python backend/server.py
```

macOS / Linux:

```bash
PORT=5050 python3 backend/server.py
```

Luego abre:

```text
http://localhost:5050
```

## Si falta Pillow

```bash
python -m pip install pillow
```

o:

```bash
py -m pip install pillow
```

## Estructura

```text
futbol7-clean-studio/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   └── db.py
│   ├── data/
│   ├── uploads/
│   └── server.py
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── README.md
```

## Flujo recomendado

1. Entra como admin.
2. Ve a Ajustes y cambia nombre de equipos y colores.
3. Ve a Jugadores.
4. Completa nombre, apodo, número y posición.
5. Sube la foto.
6. La app genera la presentación automáticamente.
7. Guarda el jugador.

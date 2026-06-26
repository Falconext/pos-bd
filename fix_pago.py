import re

with open('src/pago/pago.service.ts', 'r') as f:
    content = f.read()

content = content.replace("include: { usuario: { select: { nombre: true, apellidos: true } } }", "include: { usuario: { select: { nombre: true } } }")

with open('src/pago/pago.service.ts', 'w') as f:
    f.write(content)


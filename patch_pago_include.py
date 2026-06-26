import re

with open('src/pago/pago.service.ts', 'r') as f:
    content = f.read()

old_include = "include: { pagos: { orderBy: { fecha: 'desc' } } },"
new_include = "include: { pagos: { orderBy: { fecha: 'desc' }, include: { usuario: { select: { nombre: true, apellidos: true } } } } },"

content = content.replace(old_include, new_include)

with open('src/pago/pago.service.ts', 'w') as f:
    f.write(content)


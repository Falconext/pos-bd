"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var prisma = new client_1.PrismaClient();
prisma.producto.count({ where: { atributosTecnicos: { string_contains: 'SERVICIO' } } }).then(console.log).catch(function (e) { return console.log(e.message); }).finally(function () { return process.exit(0); });

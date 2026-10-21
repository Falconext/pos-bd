-- Corte de los vouchers del pedido en curso (cliente que vuelve)
ALTER TABLE "LeadPedidoBorrador" ADD COLUMN "pedidoDesde" TIMESTAMP(3);

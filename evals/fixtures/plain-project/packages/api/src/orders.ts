export interface Order {
  id: string;
  customer: string;
  lines: OrderLine[];
}

export interface OrderLine {
  product: string;
  quantity: number;
  unitPrice: number;
}

const orders = new Map<string, Order>();

export function saveOrder(order: Order): void {
  orders.set(order.id, order);
}

export function findOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function totalOf(order: Order): number {
  return order.lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0);
}

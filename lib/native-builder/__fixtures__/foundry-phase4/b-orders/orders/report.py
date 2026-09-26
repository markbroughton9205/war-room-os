from orders.repository import list_orders


def order_lines(orders, status=None):
    rows = list_orders(orders, status)
    return "\n".join(order["id"] for order in rows[:1])

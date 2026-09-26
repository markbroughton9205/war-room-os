def list_orders(orders, status=None):
    if status is None:
        return list(orders)
    return [order for order in orders if order["status"] == status]

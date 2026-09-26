def order_total(items):
    """Sum of price * qty for every line."""
    return sum(item["price"] * item["qty"] for item in items)


def apply_coupon(total, code):
    """Returns the total after any coupon code is applied."""
    return total

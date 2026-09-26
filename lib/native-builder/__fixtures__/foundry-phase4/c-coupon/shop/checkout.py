from shop.pricing import apply_coupon, order_total


def place_order(cart, code=None):
    total = order_total(cart)
    return apply_coupon(total, code)

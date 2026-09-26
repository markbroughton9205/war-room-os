from shop.coupons import apply_coupon
from shop.pricing import order_total


def place_order(cart, code=None):
    total = order_total(cart)
    return apply_coupon(total, code)

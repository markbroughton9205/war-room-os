from store.pricing import member_price


def checkout_total(items, customer):
    return round(sum(member_price(price, customer) * qty for price, qty in items), 2)

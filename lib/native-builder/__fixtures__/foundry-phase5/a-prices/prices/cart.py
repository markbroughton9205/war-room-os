from prices.loader import load_prices


def cart_total(items):
    """items is a list of (product, quantity). Returns the total price."""
    catalog = load_prices()
    return round(sum(catalog[product] * quantity for product, quantity in items), 2)

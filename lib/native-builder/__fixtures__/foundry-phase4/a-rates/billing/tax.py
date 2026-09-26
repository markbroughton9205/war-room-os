from billing.rates import rate_for


def add_tax(amount, region):
    return round(amount * (1 + rate_for(region)), 2)

from store.loyalty import tier_for

DISCOUNTS = {"gold": 0.10, "silver": 0.05}


def member_price(price, customer):
    """The price a member pays, after the tier discount."""
    tier = tier_for(customer)
    return round(price * (1 - DISCOUNTS.get(tier, 0.0)), 2)
